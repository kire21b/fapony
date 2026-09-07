import type { Database } from "bun:sqlite";
import type { Config } from "./db/index.js";
import { getActiveRuns, getEvents, loadConfig, openDb } from "./db/index.js";
import { pendingPlans, worktreeFromCwd } from "./plans.js";

/** Table of active runs — plan + mem_id shown so you don't have to open the
 * plan file or dig through .fapony/.memory/ to know what a run maps to. */
export function renderStatusTable(db: Database): string {
  const runs = getActiveRuns(db);
  if (runs.length === 0) return "no active runs";

  const lines = [
    "active runs:",
    "  id  | status          | round | worktree | plan                            | mem_id     | updated_at",
    "  ----|-----------------|-------|----------|---------------------------------|------------|-----------",
  ];

  for (const run of runs) {
    const events = getEvents(db, run.id);
    const hasCommit = events.some((e) => e.kind === "commit");
    const hasMemoryEvent = events.some(
      (e) => e.kind === "memory_claim" || e.kind === "memory_claim_failed",
    );
    const warn =
      hasCommit && !hasMemoryEvent ? " ⚠ commit but no memory event" : "";

    const plan = (run.plan ?? "-").padEnd(31).slice(0, 31);
    const memId = (run.mem_id ?? "-").padEnd(10).slice(0, 10);

    lines.push(
      `  ${String(run.id).padStart(3)} | ${run.status.padEnd(15)} | ${String(run.round).padStart(5)} | ${run.worktree.padEnd(8)} | ${plan} | ${memId} | ${run.updated_at}${warn}`,
    );
  }

  return lines.join("\n");
}

/** Numbered pending plans for the worktree you're standing in (numbering is
 * just for reading the list — run by filename prefix, not by number: a bare
 * digit on the CLI means run ID, not plan index). Empty string when the
 * worktree has nothing pending. */
export function renderPendingPlans(
  config: Config,
  worktreeKey: string,
): string {
  const worktree = config.worktrees[worktreeKey];
  if (!worktree) return "";
  const pending = pendingPlans(config, worktree);
  if (pending.length === 0) return "";

  const lines = [
    "",
    `pending plans (${worktreeKey}):`,
    ...pending.map((name, i) => `  #${i + 1} ${name}`),
    `  → run: fapony run <plan-prefix>  ·  e.g. fapony run ${pending[0]}`,
  ];
  return lines.join("\n");
}

export function cmdStatus(_args: string[]): void {
  const db = openDb();
  console.log(renderStatusTable(db));

  const config = loadConfig();
  const key = worktreeFromCwd(config);
  if (key) {
    const pending = renderPendingPlans(config, key);
    if (pending) console.log(pending);
  }
}
