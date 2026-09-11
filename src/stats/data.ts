// src/stats/data.ts — StatsData shape + getStatsData() + computeEfficiency()

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sumSpawnCost } from "../cost.js";
import { type Event, openDb, type Run } from "../db/index.js";
import { loadConfig } from "../db/load.js";
import { enrichGateWindows } from "../gates.js";
import { avg, minutesBetween } from "../math.js";
import { REASON_CODES } from "../mcp/types.js";
import {
  isPassFamily,
  qualityScore,
  VERDICT_GRADES,
  type VerdictGrade,
} from "../parse.js";
import {
  type PassiveUsageResult,
  readClaudeCodeUsage,
  readCodexUsage,
  readPassiveUsage,
  readZcodeUsage,
} from "../session/index.js";

// Walks events per run in order and pairs up spawn→route (executor time)
// and route→gate (review turnaround) per round, since one run row can span
// multiple rounds (spawn/commit/route/gate repeating).
function stageMinutes(events: Event[]): { exec: number[]; review: number[] } {
  const exec: number[] = [];
  const review: number[] = [];
  let spawnTs: string | null = null;
  let routeTs: string | null = null;

  for (const e of events) {
    if (e.kind === "spawn") spawnTs = e.ts;
    else if (e.kind === "route") {
      if (spawnTs) exec.push(minutesBetween(spawnTs, e.ts));
      routeTs = e.ts;
    } else if (e.kind === "gate") {
      if (routeTs) review.push(minutesBetween(routeTs, e.ts));
      routeTs = null;
    }
  }
  return { exec, review };
}

// --- Per-gate enrichment: costUSD + model + valueScore (read-time join) ---

interface EnrichedGate {
  runId: number;
  verdict: string;
  costUSD: number | null;
  model: string | null;
  provider: string | null;
  client: string | null;
  agent: string | null;
  valueScore: number | null;
  /** How `model` was resolved — "inferred" is a guess, not a declaration. */
  modelSource: "spawn" | "session_id" | "inferred" | null;
}

/**
 * Read-time join (SPEC-verdict-stats): per gate, cost/model come only from
 * kind='spawn' events in (prevGateId, gateId) of the same run — per-round,
 * never cumulative. Delegates windowing to enrichGateWindows (src/gates.ts)
 * and adds the value score on top.
 */
function enrichGates(
  events: Event[],
  worktreeByRun?: Map<number, string>,
): EnrichedGate[] {
  return enrichGateWindows(events, worktreeByRun).map((w) => {
    let valueScore: number | null = null;
    if (w.costUSD !== null && w.costUSD > 0 && w.quality !== null) {
      valueScore = w.quality / w.costUSD;
    }
    return {
      runId: w.runId,
      verdict: w.verdict,
      costUSD: w.costUSD,
      model: w.model,
      provider: w.provider,
      client: w.client,
      agent: w.agent,
      modelSource: w.modelSource,
      valueScore,
    };
  });
}

// --- Derived efficiency (PLAN-usage-depth §3): ES + CPQ per fapony run ---
//
// derived: quality comes from the run's LATEST gate verdict (read-time,
// never written), cost from sumSpawnCost over that run's spawns, minutes
// from created_at→updated_at. When no spawn was USD-priced (pricing:null or
// unpriced), bytes_in+bytes_out is used as proxy — basis flags which one.
// Label rule: text output prefixes this section with "derived:".

export interface RunEfficiency {
  runId: number;
  grade: string | null;
  /** Canonical quality via qualityScore(), or null when no/unknown grade. */
  quality: number | null;
  costUSD: number | null;
  bytes: number;
  minutes: number;
  /** quality / (cost × minutes). 0 for fail-with-cost, null when undefined. */
  es: number | null;
  /**
   * cost / quality. fail (quality=0) → null (censored, not infinite —
   * JSON-safe, distinct from "undefined/no data" when grade is present).
   * Null when undefined.
   */
  cpq: number | null;
  basis: "usd" | "bytes-proxy";
}

function lastGateVerdict(events: Event[]): string | null {
  let last: string | null = null;
  for (const e of events) {
    if (e.kind !== "gate" || !e.data) continue;
    try {
      const d = JSON.parse(e.data) as { verdict?: unknown };
      if (typeof d.verdict === "string" && VERDICT_GRADES.has(d.verdict)) {
        last = d.verdict;
      }
    } catch {
      // unparseable gate data — not a valid verdict, keep scanning
    }
  }
  return last;
}

/**
 * Per-run efficiency — the single implementation. Telemetry reuses this
 * (groups per-run results by model) so ES/CPQ semantics never drift between
 * `fapony stats` and the telemetry payload. Never reimplement per-run
 * quality/cost/minutes pairing elsewhere.
 */
export function computeEfficiency(
  runs: Run[],
  eventsByRun: Record<number, Event[]>,
): RunEfficiency[] {
  const out: RunEfficiency[] = [];
  for (const r of runs) {
    const es = eventsByRun[r.id] ?? [];
    const grade = lastGateVerdict(es);
    const quality = grade !== null ? qualityScore(grade as VerdictGrade) : null;
    const cost = sumSpawnCost(es);
    const minutes = minutesBetween(r.created_at, r.updated_at);
    const bytes = cost.bytes_in + cost.bytes_out;

    const useUsd = cost.usd_estimate !== null && cost.usd_estimate > 0;
    const basis: "usd" | "bytes-proxy" = useUsd ? "usd" : "bytes-proxy";
    const denom = useUsd ? (cost.usd_estimate as number) : bytes;

    let eScore: number | null = null;
    let cpq: number | null = null;
    if (quality !== null && minutes > 0 && denom > 0) {
      eScore = quality / (denom * minutes);
      // fail (quality=0) → censored cpq: cannot divide meaningfully.
      cpq = quality > 0 ? denom / quality : null;
    }

    out.push({
      runId: r.id,
      grade,
      quality,
      costUSD: cost.usd_estimate,
      bytes,
      minutes,
      es: eScore,
      cpq,
      basis,
    });
  }
  return out.sort((a, b) => a.runId - b.runId);
}

/**
 * Count un-shipped plan files in a worktree's planDir.
 *
 * Reads the *target repo's own* fapony.config.json for `paths.planDir` — the
 * central config's worktrees map is optional and usually absent, and each repo
 * picks its own plan dir (vela uses apps/vela/plan, not .fapony/plan).
 *
 * Returns null — never 0 — when the path isn't a readable directory, so a
 * sentinel row like "mcp-external" renders as "—" instead of claiming
 * "nothing pending", which would be a lie.
 */
export function countPendingPlans(worktree: string): number | null {
  if (!worktree.startsWith("/")) return null;
  let planDir = ".fapony/plan";
  try {
    const cfg = JSON.parse(
      readFileSync(join(worktree, "fapony.config.json"), "utf8"),
    ) as { paths?: { planDir?: unknown } };
    if (typeof cfg.paths?.planDir === "string" && cfg.paths.planDir)
      planDir = cfg.paths.planDir;
  } catch {
    // no config (or unreadable/malformed) — fall back to the scaffold default
  }
  try {
    return readdirSync(join(worktree, planDir)).filter((f) => f.endsWith(".md"))
      .length;
  } catch {
    return null;
  }
}

// --- Cross-run knowledge queries (PLAN-project-health-context §2) ---
//
// Pure functions over already-loaded runs/events — no extra SQL, read-only.
// reason_code comes from gate event data: `reason_code` field (patched by
// verdict_submit) with fallback to the `[reason_code]` note prefix that
// gateOnce writes. Only non-pass gates count (recurring failure signature).

export interface ReasonCodeCount {
  worktree: string;
  reason: string;
  count: number;
}

export interface PlanBreakdown {
  plan: string;
  runs: number;
  passed: number;
  escalated: number;
  /** Worktrees that have at least one run with this plan (sorted). */
  worktrees: string[];
}

export interface EscalatedRun {
  id: number;
  worktree: string;
  plan: string | null;
  round: number;
}

export interface BestPassing {
  plan: string;
  worktree: string;
}

/** maxRounds from config (default 2) — the round-cap signal (CLAUDE.md #2). */
export function resolveMaxRounds(): number {
  try {
    const mr = loadConfig().review?.maxRounds;
    return typeof mr === "number" && mr >= 0 ? mr : 2;
  } catch {
    return 2;
  }
}

/** Reason code on a gate event, regardless of pass/fail (for note surfacing). */
function eventReasonCode(data: string | null): string | null {
  if (!data) return null;
  try {
    const d = JSON.parse(data) as { reason_code?: unknown; note?: unknown };
    if (
      typeof d.reason_code === "string" &&
      (REASON_CODES as readonly string[]).includes(d.reason_code)
    )
      return d.reason_code;
    // Fallback: gateOnce writes `[reason_code]` note prefix via verdict_submit.
    if (typeof d.note === "string") {
      const m = /^\[([a-z_]+)\]/.exec(d.note);
      if (m && (REASON_CODES as readonly string[]).includes(m[1])) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** Reason code on a non-pass gate event only (byReasonCode KPI — fail signal). */
function gateReason(data: string | null): string | null {
  if (!data) return null;
  try {
    const d = JSON.parse(data) as { verdict?: unknown };
    if (
      typeof d.verdict === "string" &&
      (d.verdict === "pass" || d.verdict.startsWith("pass-"))
    )
      return null;
  } catch {
    return null;
  }
  return eventReasonCode(data);
}

export interface FileRisk {
  worktree: string;
  file: string;
  /** Gate verdicts that listed this file. */
  gates: number;
  /** Of those, non-pass-family verdicts. */
  fails: number;
  /** reason_code of the most recent failing gate on this file. */
  lastReason: string | null;
}

/**
 * Per-file risk: how often a file appeared in a gate verdict, and how often
 * that verdict was non-pass. Reads files[] already stored on gate events —
 * no new table, no new write path.
 *
 * Counts are "touches that were graded", not edits: a file only shows up here
 * once someone submitted a verdict naming it, so absence means unmeasured,
 * never safe. Read a row as a prior, not a score — at gates=1 it is one
 * anecdote.
 */
export function getFileRisk(runs: Run[], events: Event[]): FileRisk[] {
  const wtByRun = new Map(runs.map((r) => [r.id, r.worktree]));
  const map = new Map<
    string,
    {
      worktree: string;
      file: string;
      gates: number;
      fails: number;
      lastReason: string | null;
    }
  >();
  for (const e of events) {
    if (e.kind !== "gate") continue;
    let verdict: string | null = null;
    let files: string[] = [];
    try {
      const d = JSON.parse(e.data ?? "{}") as {
        verdict?: unknown;
        files?: unknown;
      };
      if (typeof d.verdict === "string" && VERDICT_GRADES.has(d.verdict))
        verdict = d.verdict;
      if (Array.isArray(d.files))
        files = d.files.filter(
          (f): f is string => typeof f === "string" && !!f,
        );
    } catch {
      continue; // unparseable gate data — nothing to attribute
    }
    if (!verdict || files.length === 0) continue;
    const wt = wtByRun.get(e.run_id) ?? "(unknown)";
    const failed = !isPassFamily(verdict);
    const reason = failed ? eventReasonCode(e.data) : null;
    for (const file of files) {
      const key = `${wt}\u0000${file}`;
      let b = map.get(key);
      if (!b) {
        b = { worktree: wt, file, gates: 0, fails: 0, lastReason: null };
        map.set(key, b);
      }
      b.gates++;
      if (failed) {
        b.fails++;
        // events arrive oldest-first, so the last write wins = most recent.
        if (reason) b.lastReason = reason;
      }
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.fails - a.fails ||
      b.gates - a.gates ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
}

/** Top reason_code per worktree, sorted by count desc (spec §2 query). */
export function getReasonCodeBreakdown(
  runs: Run[],
  events: Event[],
): ReasonCodeCount[] {
  const wtByRun = new Map(runs.map((r) => [r.id, r.worktree]));
  const counts = new Map<string, Map<string, number>>();
  for (const e of events) {
    if (e.kind !== "gate") continue;
    const reason = gateReason(e.data);
    if (!reason) continue;
    const wt = wtByRun.get(e.run_id) ?? "(unknown)";
    let inner = counts.get(wt);
    if (!inner) {
      inner = new Map();
      counts.set(wt, inner);
    }
    inner.set(reason, (inner.get(reason) ?? 0) + 1);
  }
  const out: ReasonCodeCount[] = [];
  for (const [worktree, inner] of counts)
    for (const [reason, count] of inner) out.push({ worktree, reason, count });
  return out.sort((a, b) => b.count - a.count);
}

export interface RecentVerdictNote {
  worktree: string;
  reason: string;
  note: string;
  ts: string;
  files?: string[];
}

/**
 * Most recent gate notes with actual text, ANY verdict (spec §2 knowledge-
 * accumulation extra) — unlike byReasonCode (fail-only KPI), a pass-adequate
 * note still carries signal ("worked around X"). Sorted newest first, capped
 * at `limit`.
 *
 * `limit` is a collection cap, not a display cap: callers filter this list
 * (by worktree, by files[]) and slice it themselves, so pass enough to filter
 * over — see the getStatsData call site.
 */
export function getRecentVerdictNotes(
  runs: Run[],
  events: Event[],
  limit = 3,
): RecentVerdictNote[] {
  const wtByRun = new Map(runs.map((r) => [r.id, r.worktree]));
  const out: RecentVerdictNote[] = [];
  // events is oldest→first per typical read order; walk backwards for recency.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== "gate") continue;
    const reason = eventReasonCode(e.data);
    if (!reason) continue; // no recognizable reason_code
    let note = "";
    try {
      const d = JSON.parse(e.data ?? "{}") as { note?: unknown };
      if (typeof d.note === "string") note = d.note;
    } catch {
      // unparseable — skip note text, keep looking
    }
    note = note.replace(/^\[[a-z_]+\]\s*/, "").trim();
    if (!note) continue; // no free-text note beyond the reason_code tag
    // Extract files[] stored in gate event data (added by step 3 of
    // PLAN-loop-and-savings). When present, enables file-scoped filtering
    // in project_health_context.
    let files: string[] | undefined;
    try {
      const d2 = JSON.parse(e.data ?? "{}") as { files?: unknown };
      if (Array.isArray(d2.files) && d2.files.length > 0) {
        files = d2.files.filter((f): f is string => typeof f === "string");
      }
    } catch {
      // no files field — that's fine
    }
    out.push({
      worktree: wtByRun.get(e.run_id) ?? "(unknown)",
      reason,
      note,
      ts: e.ts,
      ...(files ? { files } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Per-plan totals with pass + escalation counts. */
export function getPlanBreakdown(
  runs: Run[],
  maxRounds: number,
): PlanBreakdown[] {
  const map = new Map<
    string,
    { runs: number; passed: number; escalated: number; worktrees: Set<string> }
  >();
  for (const r of runs) {
    const plan = r.plan ?? "(no plan)";
    let b = map.get(plan);
    if (!b) {
      b = { runs: 0, passed: 0, escalated: 0, worktrees: new Set() };
      map.set(plan, b);
    }
    b.runs++;
    if (r.status === "passed") b.passed++;
    if (r.round > maxRounds) b.escalated++;
    b.worktrees.add(r.worktree);
  }
  return [...map.entries()]
    .map(([plan, b]) => ({
      plan,
      runs: b.runs,
      passed: b.passed,
      escalated: b.escalated,
      worktrees: [...b.worktrees].sort(),
    }))
    .sort((a, b) => b.runs - a.runs);
}

export interface PlanLastVerdict {
  plan: string;
  runs: number;
  lastVerdict: string;
  /** null for a pass-family last verdict (gateReason only flags non-pass). */
  lastReasonCode: string | null;
  escalated: boolean;
}

/**
 * Most recent gate verdict per plan string, for `plan_list` (mcp/tools/plans.ts)
 * to join filesystem plan files against real run history — "2 runs, last:
 * fail(spec_gap)" instead of a bare directory listing.
 */
export function getLastVerdictByPlan(
  runs: Run[],
  events: Event[],
  maxRounds: number,
): PlanLastVerdict[] {
  const runById = new Map(runs.map((r) => [r.id, r]));
  const runCounts = new Map<string, number>();
  const escalatedPlans = new Set<string>();
  for (const r of runs) {
    if (!r.plan) continue;
    runCounts.set(r.plan, (runCounts.get(r.plan) ?? 0) + 1);
    if (r.round > maxRounds) escalatedPlans.add(r.plan);
  }

  const lastGateByPlan = new Map<
    string,
    { ts: string; verdict: string; reason: string | null }
  >();
  for (const e of events) {
    if (e.kind !== "gate" || !e.data) continue;
    const plan = runById.get(e.run_id)?.plan;
    if (!plan) continue;
    let verdict: string | null = null;
    try {
      const d = JSON.parse(e.data) as { verdict?: unknown };
      if (typeof d.verdict === "string") verdict = d.verdict;
    } catch {
      continue;
    }
    if (!verdict) continue;
    const prev = lastGateByPlan.get(plan);
    if (!prev || e.ts >= prev.ts) {
      lastGateByPlan.set(plan, {
        ts: e.ts,
        verdict,
        reason: gateReason(e.data),
      });
    }
  }

  return [...runCounts.keys()].map((plan) => {
    const last = lastGateByPlan.get(plan);
    return {
      plan,
      runs: runCounts.get(plan) ?? 0,
      lastVerdict: last?.verdict ?? "(no gate yet)",
      lastReasonCode: last?.reason ?? null,
      escalated: escalatedPlans.has(plan),
    };
  });
}

/** Runs past the round cap — plan-quality signal, not code (CLAUDE.md #2). */
export function getEscalatedRuns(
  runs: Run[],
  maxRounds: number,
): EscalatedRun[] {
  return runs
    .filter((r) => r.round > maxRounds)
    .map((r) => ({
      id: r.id,
      worktree: r.worktree,
      plan: r.plan,
      round: r.round,
    }))
    .sort((a, b) => a.id - b.id);
}

/** Plans that passed at round 1 — worth reusing as a template (spec §2). */
export function getBestPassing(runs: Run[], events: Event[]): BestPassing[] {
  const passRunIds = new Set<number>();
  for (const e of events) {
    if (e.kind !== "gate" || !e.data) continue;
    try {
      const d = JSON.parse(e.data) as { verdict?: unknown };
      if (
        typeof d.verdict === "string" &&
        (d.verdict === "pass" || d.verdict.startsWith("pass-"))
      )
        passRunIds.add(e.run_id);
    } catch {
      // unparseable — skip
    }
  }
  return runs
    .filter((r) => r.round <= 1 && r.plan !== null && passRunIds.has(r.id))
    .map((r) => ({ plan: r.plan as string, worktree: r.worktree }))
    .sort((a, b) => (a.plan < b.plan ? -1 : 1));
}

export interface StatsData {
  runs: {
    total: number;
    byStatus: Record<string, number>;
    passRate: number;
    stallRate: number;
    avgRounds: number;
    avgMinutes: number;
  };
  cost: {
    spawns: number;
    bytes_in: number;
    bytes_out: number;
    usd_estimate: number | null;
  };
  stages: {
    exec: { avg: number; count: number };
    review: { avg: number; count: number };
  };
  byModel: Array<{
    client: string;
    provider: string;
    model: string;
    agent: string;
    gateCount: number;
    /** Non-pass-family verdicts in this bucket. */
    fails: number;
    /** fails / gateCount — the per-model question nothing else can answer. */
    failRate: number;
    avgQuality: number;
    avgCostUSD: number | null;
    avgValue: number | null;
  }>;
  /** How many gates got their model by inference vs. a declared session_id. */
  modelAttribution: { inferred: number; declared: number; none: number };
  byGrade: Array<{
    grade: string;
    count: number;
    avgCostUSD: number | null;
  }>;
  byWorktree: Array<{
    worktree: string;
    runs: number;
    passed: number;
    stalled: number;
    /** Un-shipped plan files in that repo's planDir, or null when uncountable. */
    pending: number | null;
  }>;
  /** Derived ES/CPQ per run (PLAN-usage-depth §3) — additive, always present. */
  efficiency: RunEfficiency[];
  /** Cross-run knowledge (PLAN-project-health-context §2) — additive, always present. */
  byReasonCode: ReasonCodeCount[];
  byPlan: PlanBreakdown[];
  escalatedRuns: EscalatedRun[];
  bestPassing: BestPassing[];
  recentVerdictNotes: RecentVerdictNote[];
  /** Per-file gate/fail counts (risk heatmap), worst first. */
  byFile: FileRisk[];
  usage: PassiveUsageResult;
  /** ZCode passive usage (when ~/.zcode/cli/db/db.sqlite exists). */
  zcodeUsage?: PassiveUsageResult | null;
  /** Claude Code passive usage (when ~/.claude/projects/ exists). */
  claudeCodeUsage?: PassiveUsageResult | null;
  /** Codex passive usage (when ~/.codex/sessions/ exists). */
  codexUsage?: PassiveUsageResult | null;
  /** ISO timestamp of the most recent run creation (for freshness display). */
  latestRunAt: string;
}

export function getStatsData(): StatsData {
  const db = openDb();
  try {
    const runs = db.prepare("SELECT * FROM runs ORDER BY id").all() as Run[];
    const events = db
      .prepare("SELECT * FROM events ORDER BY run_id, id")
      .all() as Event[];

    // --- Runs summary ---
    const byStatus: Record<string, number> = {};
    for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    const terminal = runs.filter((r) =>
      ["passed", "stopped", "stalled"].includes(r.status),
    );
    const passed = runs.filter((r) => r.status === "passed");

    const passRate = terminal.length ? passed.length / terminal.length : 0;
    const stallRate = terminal.length
      ? (byStatus.stalled ?? 0) / terminal.length
      : 0;
    const avgRounds = passed.length
      ? passed.reduce((s, r) => s + r.round, 0) / passed.length
      : 0;
    const avgMinutes = passed.length
      ? passed.reduce(
          (s, r) => s + minutesBetween(r.created_at, r.updated_at),
          0,
        ) / passed.length
      : 0;

    // --- Cost total (bytes always, USD only when pricing set). ---
    const cost = sumSpawnCost(events);

    // --- Stages ---
    const eventsByRun: Record<number, Event[]> = {};
    for (const e of events) (eventsByRun[e.run_id] ??= []).push(e);

    const execAll: number[] = [];
    const reviewAll: number[] = [];
    for (const es of Object.values(eventsByRun)) {
      const { exec, review } = stageMinutes(es);
      execAll.push(...exec);
      reviewAll.push(...review);
    }

    // --- Gate enrichment ---
    const enriched = enrichGates(
      events,
      new Map(runs.map((r) => [r.id, r.worktree])),
    );

    // Group by client+provider+model+agent — the same model name on two
    // providers is two different things. Unknown dimension → "—" (never ""
    // or "(unknown)").
    const modelMap: Record<
      string,
      {
        client: string;
        provider: string;
        model: string;
        agent: string;
        gateCount: number;
        fails: number;
        qualities: number[];
        costs: number[];
        values: number[];
      }
    > = {};
    for (const g of enriched) {
      const client = g.client ?? "—";
      const provider = g.provider ?? "—";
      const model = g.model ?? "—";
      const agent = g.agent ?? "—";
      const key = [client, provider, model, agent].join("\0");
      const bucket = (modelMap[key] ??= {
        client,
        provider,
        model,
        agent,
        gateCount: 0,
        fails: 0,
        qualities: [],
        costs: [],
        values: [],
      });
      bucket.gateCount++;
      if (g.verdict && !isPassFamily(g.verdict)) bucket.fails++;
      const grade = g.verdict as VerdictGrade;
      if (VERDICT_GRADES.has(grade)) bucket.qualities.push(qualityScore(grade));
      if (g.costUSD !== null) bucket.costs.push(g.costUSD);
      if (g.valueScore !== null) bucket.values.push(g.valueScore);
    }
    const byModel = Object.values(modelMap)
      .map((b) => ({
        client: b.client,
        provider: b.provider,
        model: b.model,
        agent: b.agent,
        gateCount: b.gateCount,
        fails: b.fails,
        failRate: b.gateCount ? b.fails / b.gateCount : 0,
        avgQuality: b.qualities.length ? avg(b.qualities) : 0,
        avgCostUSD: b.costs.length ? avg(b.costs) : null,
        avgValue: b.values.length ? avg(b.values) : null,
      }))
      .sort((a, b) => b.gateCount - a.gateCount);

    const modelAttribution = { inferred: 0, declared: 0, none: 0 };
    for (const g of enriched) {
      if (g.modelSource === "inferred") modelAttribution.inferred++;
      else if (g.modelSource === null) modelAttribution.none++;
      else modelAttribution.declared++;
    }

    const gradeMap: Record<string, { count: number; costs: number[] }> = {};
    for (const g of enriched) {
      const gr = g.verdict || "(unknown)";
      const bucket = (gradeMap[gr] ??= { count: 0, costs: [] });
      bucket.count++;
      if (g.costUSD !== null) bucket.costs.push(g.costUSD);
    }
    const byGrade = Object.entries(gradeMap)
      .map(([grade, b]) => ({
        grade,
        count: b.count,
        avgCostUSD: b.costs.length ? avg(b.costs) : null,
      }))
      .sort((a, b) => b.count - a.count);

    const wtMap: Record<
      string,
      { runs: number; passed: number; stalled: number }
    > = {};
    for (const r of runs) {
      const b = (wtMap[r.worktree] ??= { runs: 0, passed: 0, stalled: 0 });
      b.runs++;
      if (r.status === "passed") b.passed++;
      if (r.status === "stalled") b.stalled++;
    }
    const byWorktree = Object.entries(wtMap)
      .map(([worktree, b]) => ({
        worktree,
        ...b,
        pending: countPendingPlans(worktree),
      }))
      .sort((a, b) => b.runs - a.runs);

    const usage = readPassiveUsage();
    const zcodeUsage = readZcodeUsage();
    const claudeCodeUsage = readClaudeCodeUsage();
    const codexUsage = readCodexUsage();

    const efficiency = computeEfficiency(runs, eventsByRun);

    const maxRounds = resolveMaxRounds();

    // Latest run creation timestamp (for freshness display in reports)
    const latestRunAt = runs.length
      ? runs.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at
      : "";

    return {
      runs: {
        total: runs.length,
        byStatus,
        passRate,
        stallRate,
        avgRounds,
        avgMinutes,
      },
      cost,
      stages: {
        exec: { avg: avg(execAll), count: execAll.length },
        review: { avg: avg(reviewAll), count: reviewAll.length },
      },
      byModel,
      modelAttribution,
      byGrade,
      byWorktree,
      efficiency,
      byReasonCode: getReasonCodeBreakdown(runs, events),
      byPlan: getPlanBreakdown(runs, maxRounds),
      escalatedRuns: getEscalatedRuns(runs, maxRounds),
      bestPassing: getBestPassing(runs, events),
      // 50, not the display cap of 3: project_health_context filters this
      // list by worktree and files[] before slicing, so a cap of 3 here would
      // throw away the very notes a file-scoped query is looking for.
      recentVerdictNotes: getRecentVerdictNotes(runs, events, 50),
      byFile: getFileRisk(runs, events),
      usage,
      zcodeUsage: zcodeUsage.session_count > 0 ? zcodeUsage : null,
      claudeCodeUsage:
        claudeCodeUsage.session_count > 0 ? claudeCodeUsage : null,
      codexUsage: codexUsage.session_count > 0 ? codexUsage : null,
      latestRunAt,
    };
  } finally {
    // The MCP server is a long-lived stdio process — polling tools must not
    // leak one SQLite handle per call.
    db.close();
  }
}
