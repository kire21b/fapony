// src/context/projectHealth.ts — project-health context block builder
//
// Composes the cross-run knowledge queries (PLAN-project-health-context §2)
// into a short plain-text block fed to `plan-with-me` as "known patterns"
// before drafting. Framed as "watch for", never "must follow" (overfitting
// guard — PLAN §5). Pure function over StatsData: no DB, no I/O.

import type { StatsData } from "../stats/data.js";

export interface HealthContextOptions {
  /** Scope to one worktree path. Global across worktrees when omitted. */
  worktree?: string;
  /** Max reason_code rows (default 3 — PLAN §5 escape hatch against prompt bloat). */
  topReasons?: number;
  /** Min runs before trends are reported (default 5 — PLAN §5 sample-size guard). */
  minRuns?: number;
}

/**
 * Build the "known patterns" block (spec §3 shape, capped ~15 lines).
 * Low-history scopes get an explicit "not enough history yet" line instead
 * of noise from n=1 patterns looking like trends.
 */
export function buildProjectHealthContext(
  data: StatsData,
  opts?: HealthContextOptions,
): string {
  const worktree = opts?.worktree;
  const topReasons = opts?.topReasons ?? 3;
  const minRuns = opts?.minRuns ?? 5;

  const total = worktree
    ? (data.byWorktree.find((w) => w.worktree === worktree)?.runs ?? 0)
    : data.runs.total;
  const scope = worktree ?? "all worktrees";
  const header = `## Known patterns for this project (from fapony history, N=${total} runs, ${scope})`;

  if (total < minRuns) {
    return [
      header,
      `- Not enough history yet (${total} runs, need ${minRuns}+) — no recurring patterns to report; draft freely.`,
    ].join("\n");
  }

  const reasons = (
    worktree
      ? data.byReasonCode.filter((r) => r.worktree === worktree)
      : data.byReasonCode
  ).slice(0, Math.max(topReasons, 0));
  const escalated = worktree
    ? data.escalatedRuns.filter((e) => e.worktree === worktree)
    : data.escalatedRuns;
  const passing = (
    worktree
      ? data.bestPassing.filter((b) => b.worktree === worktree)
      : data.bestPassing
  ).slice(0, 3);

  const lines = [header];
  if (reasons.length > 0) {
    const list = reasons.map((r) => `${r.reason} (${r.count}×)`).join(", ");
    lines.push(
      `- Recurring fail reasons (non-pass gates): ${list} — watch for these in the new plan.`,
    );
  }
  if (escalated.length > 0) {
    // Top-1 concrete example only (PLAN §5: never dump full history).
    const ex = escalated[0];
    const planBit = ex.plan
      ? ` (e.g. plan "${ex.plan}", round ${ex.round})`
      : "";
    lines.push(
      `- ${escalated.length} run${escalated.length === 1 ? "" : "s"} escalated past the round cap${planBit} — likely the plan was underspecified, not the code.`,
    );
  }
  if (passing.length > 0) {
    const list = passing.map((b) => `"${b.plan}"`).join(", ");
    lines.push(
      `- Passed round 1 before: ${list} — shapes worth reusing when they fit.`,
    );
  }
  if (lines.length === 1) {
    lines.push(
      "- No recurring failure or escalation patterns observed — draft freely, keep the scope tight.",
    );
  }
  return lines.slice(0, 15).join("\n");
}
