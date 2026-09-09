// src/stats/data.ts — StatsData shape + getStatsData() + computeEfficiency()

import { sumSpawnCost } from "../cost.js";
import { type Event, openDb, type Run } from "../db/index.js";
import { enrichGateWindows } from "../gates.js";
import { avg, minutesBetween } from "../math.js";
import { qualityScore, VERDICT_GRADES, type VerdictGrade } from "../parse.js";
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
  valueScore: number | null;
}

/**
 * Read-time join (SPEC-verdict-stats): per gate, cost/model come only from
 * kind='spawn' events in (prevGateId, gateId) of the same run — per-round,
 * never cumulative. Delegates windowing to enrichGateWindows (src/gates.ts)
 * and adds the value score on top.
 */
function enrichGates(events: Event[]): EnrichedGate[] {
  return enrichGateWindows(events).map((w) => {
    let valueScore: number | null = null;
    if (w.costUSD !== null && w.costUSD > 0 && w.quality !== null) {
      valueScore = w.quality / w.costUSD;
    }
    return {
      runId: w.runId,
      verdict: w.verdict,
      costUSD: w.costUSD,
      model: w.model,
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

// --- StatsData shape (SPEC-verdict-stats §StatsData) ---

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
    model: string;
    gateCount: number;
    avgQuality: number;
    avgCostUSD: number | null;
    avgValue: number | null;
  }>;
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
  }>;
  /** Derived ES/CPQ per run (PLAN-usage-depth §3) — additive, always present. */
  efficiency: RunEfficiency[];
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
    const enriched = enrichGates(events);

    const modelMap: Record<
      string,
      {
        gateCount: number;
        qualities: number[];
        costs: number[];
        values: number[];
      }
    > = {};
    for (const g of enriched) {
      const m = g.model ?? "(unknown)";
      const bucket = (modelMap[m] ??= {
        gateCount: 0,
        qualities: [],
        costs: [],
        values: [],
      });
      bucket.gateCount++;
      const grade = g.verdict as VerdictGrade;
      if (VERDICT_GRADES.has(grade)) bucket.qualities.push(qualityScore(grade));
      if (g.costUSD !== null) bucket.costs.push(g.costUSD);
      if (g.valueScore !== null) bucket.values.push(g.valueScore);
    }
    const byModel = Object.entries(modelMap)
      .map(([model, b]) => ({
        model,
        gateCount: b.gateCount,
        avgQuality: b.qualities.length ? avg(b.qualities) : 0,
        avgCostUSD: b.costs.length ? avg(b.costs) : null,
        avgValue: b.values.length ? avg(b.values) : null,
      }))
      .sort((a, b) => b.gateCount - a.gateCount);

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
      .map(([worktree, b]) => ({ worktree, ...b }))
      .sort((a, b) => b.runs - a.runs);

    const usage = readPassiveUsage();
    const zcodeUsage = readZcodeUsage();
    const claudeCodeUsage = readClaudeCodeUsage();
    const codexUsage = readCodexUsage();

    const efficiency = computeEfficiency(runs, eventsByRun);

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
      byGrade,
      byWorktree,
      efficiency,
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
