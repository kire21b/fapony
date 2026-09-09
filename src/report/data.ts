// src/report/data.ts — report data shapes + collection from SQLite

import { sumSpawnCost } from "../cost.js";
import { type Event, openDb, type Run } from "../db/index.js";
import { enrichGateWindows } from "../gates.js";

// ─── Data shapes ───────────────────────────────────────────────────────

export interface RunRow {
  id: number;
  worktree: string;
  plan: string | null;
  status: string;
  round: number;
  created_at: string;
  updated_at: string;
}

export interface GateRow {
  run_id: number;
  verdict: string;
  round: number;
  model: string;
  /** Canonical quality from the shared gate helper (null when unknown). */
  quality: number | null;
  cost_usd: number | null;
}

export interface ReportData {
  runs: RunRow[];
  gates: GateRow[];
  total_cost_usd: number;
  generated_at: string;
}

/** Collect report data. Exported for tests. */
export function collectReportData(): ReportData {
  const db = openDb();
  try {
    const runs = db.prepare("SELECT * FROM runs ORDER BY id").all() as Run[];
    const events = db
      .prepare("SELECT * FROM events ORDER BY run_id, id")
      .all() as Event[];

    // Per-round gate windows from the shared helper (src/gates.ts) — the
    // same disjoint windows stats.ts uses, never cumulative.
    const gates: GateRow[] = enrichGateWindows(events).map((w) => ({
      run_id: w.runId,
      verdict: w.verdict || "(unknown)",
      round: w.round,
      model: w.model ?? "(unknown)",
      quality: w.quality,
      cost_usd: w.costUSD,
    }));

    // True total: each spawn counted once (never the per-gate window sum,
    // which would double-count round-1 spawns on multi-round runs).
    const totalCost = sumSpawnCost(events);

    return {
      runs: runs.map((r) => ({
        id: r.id,
        worktree: r.worktree,
        plan: r.plan,
        status: r.status,
        round: r.round,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      gates,
      total_cost_usd: totalCost.usd_estimate ?? 0,
      generated_at: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}
