import { sumSpawnCost } from "./cost.js";
import { type Event, openDb, type Run } from "./db/index.js";
import { enrichGateWindows } from "./gates.js";
import { avg, minutesBetween } from "./math.js";
import { qualityScore, VERDICT_GRADES, type VerdictGrade } from "./parse.js";
import {
  type PassiveUsageResult,
  readClaudeCodeUsage,
  readPassiveUsage,
  readZcodeUsage,
} from "./session/index.js";

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
    // Deliberately no breakdown by role/worktree/pass — add when a real
    // question needs it (PLAN-cost-routing §ไม่ทำ). Breakdown by model/grade
    // is computed read-time from the same event pass (PLAN-verdict-stats).
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

    const efficiency = computeEfficiency(runs, eventsByRun);

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
    };
  } finally {
    // The MCP server is a long-lived stdio process — polling tools must not
    // leak one SQLite handle per call.
    db.close();
  }
}

// --- Shared formatter: CLI and MCP text mode render from this one function ---

function fmtRate(r: number): string {
  return `${(r * 100).toFixed(0)}%`;
}

function fmtNullable(n: number | null, digits = 2): string {
  return n !== null ? n.toFixed(digits) : "—";
}

export function formatStatsText(data: StatsData): string {
  if (data.runs.total === 0) return "no runs yet";

  const lines: string[] = [];

  lines.push(
    `runs: ${data.runs.total}  (${Object.entries(data.runs.byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")})`,
  );
  lines.push(
    `pass rate: ${fmtRate(data.runs.passRate)}  stall rate: ${fmtRate(data.runs.stallRate)}`,
  );
  lines.push(
    `avg rounds to pass: ${data.runs.avgRounds.toFixed(1)}  avg time to pass: ${data.runs.avgMinutes.toFixed(0)}m`,
  );

  if (data.cost.spawns > 0) {
    const usd =
      data.cost.usd_estimate !== null
        ? ` (~$${data.cost.usd_estimate.toFixed(4)} est.)`
        : "";
    lines.push(
      `cost: ${data.cost.bytes_in} bytes in / ${data.cost.bytes_out} bytes out over ${data.cost.spawns} spawns${usd}`,
    );
  }

  lines.push(
    `avg exec time (spawn→route): ${data.stages.exec.avg.toFixed(1)}m over ${data.stages.exec.count} rounds`,
  );
  lines.push(
    `avg review turnaround (route→gate): ${data.stages.review.avg.toFixed(1)}m over ${data.stages.review.count} rounds`,
  );

  if (data.byModel.length > 0) {
    lines.push("\nby model:");
    lines.push("  model | gates | avgQuality | avgCostUSD | avgValue");
    lines.push("  ------|-------|------------|------------|--------");
    for (const m of data.byModel) {
      lines.push(
        `  ${m.model.padEnd(8)} | ${String(m.gateCount).padStart(5)} | ${m.avgQuality.toFixed(1).padStart(10)} | ${fmtNullable(m.avgCostUSD).padStart(10)} | ${fmtNullable(m.avgValue).padStart(8)}`,
      );
    }
  }

  if (data.byGrade.length > 0) {
    lines.push("\nby grade:");
    lines.push("  grade | count | avgCostUSD");
    lines.push("  ------|-------|-----------");
    for (const g of data.byGrade) {
      lines.push(
        `  ${g.grade.padEnd(14)} | ${String(g.count).padStart(5)} | ${fmtNullable(g.avgCostUSD).padStart(10)}`,
      );
    }
  }

  if (data.byWorktree.length > 0) {
    lines.push("\nby worktree:");
    lines.push("  worktree | runs | passed | stalled");
    lines.push("  ---------|------|--------|--------");
    for (const w of data.byWorktree) {
      lines.push(
        `  ${w.worktree.padEnd(8)} | ${String(w.runs).padStart(4)} | ${String(w.passed).padStart(6)} | ${String(w.stalled).padStart(7)}`,
      );
    }
  }

  const effShown = data.efficiency.filter((e) => e.quality !== null);
  if (effShown.length > 0) {
    lines.push(
      "\nderived: efficiency (ES/CPQ per run — activity signal, not quality)",
    );
    lines.push("  run | grade | ES | CPQ | basis");
    lines.push("  ----|-------|----|-----|------");
    for (const e of effShown) {
      const es =
        e.es !== null && Number.isFinite(e.es) ? e.es.toExponential(2) : "—";
      const cpq =
        e.cpq !== null
          ? e.basis === "usd"
            ? `$${e.cpq.toFixed(4)}`
            : `${Math.round(e.cpq)}B`
          : "—";
      lines.push(
        `  ${String(e.runId).padStart(3)} | ${(e.grade ?? "?").padEnd(14)} | ${es.padStart(9)} | ${cpq.padStart(9)} | ${e.basis}`,
      );
    }
  }

  if (data.usage.session_count > 0) {
    lines.push("\nusage:");
    lines.push(
      `  total: ${data.usage.total_tokens_input} input / ${data.usage.total_tokens_output} output / ${data.usage.total_tokens_reasoning} reasoning tokens over ${data.usage.session_count} sessions ($${data.usage.total_cost.toFixed(4)})`,
    );
    if (data.usage.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of data.usage.by_model) {
        lines.push(
          `    ${m.model}: ${m.tokens_input} in / ${m.tokens_output} out ($${m.cost.toFixed(4)})`,
        );
      }
    }
  }

  // ZCode usage (separate DB)
  if (data.zcodeUsage && data.zcodeUsage.session_count > 0) {
    const zu = data.zcodeUsage;
    lines.push("\nzcode usage:");
    lines.push(
      `  total: ${zu.total_tokens_input} in / ${zu.total_tokens_output} out / ${zu.total_tokens_reasoning} reasoning tokens over ${zu.session_count} sessions`,
    );
    if (zu.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of zu.by_model) {
        lines.push(
          `    ${m.model}: ${m.tokens_input} in / ${m.tokens_output} out`,
        );
      }
    }
  }

  // Claude Code usage (JSONL files)
  if (data.claudeCodeUsage && data.claudeCodeUsage.session_count > 0) {
    const cc = data.claudeCodeUsage;
    lines.push("\nclaude code usage:");
    lines.push(
      `  total: ${cc.total_tokens_input.toLocaleString()} in / ${cc.total_tokens_output.toLocaleString()} out / ${cc.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${cc.session_count} sessions`,
    );
    if (cc.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of cc.by_model) {
        lines.push(
          `    ${m.model}: ${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out`,
        );
      }
    }
  }

  return lines.join("\n");
}

export function cmdStats(_args: string[]): void {
  console.log(formatStatsText(getStatsData()));
}
