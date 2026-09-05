import type { Database } from "bun:sqlite";
import { openDb, getActiveRuns, getEvents } from "./db.js";

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
      (e) => e.kind === "memory_claim" || e.kind === "memory_claim_failed"
    );
    const warn =
      hasCommit && !hasMemoryEvent ? " ⚠ commit but no memory event" : "";

    const plan = (run.plan ?? "-").padEnd(31).slice(0, 31);
    const memId = (run.mem_id ?? "-").padEnd(10);

    lines.push(
      `  ${String(run.id).padStart(3)} | ${run.status.padEnd(15)} | ${String(run.round).padStart(5)} | ${run.worktree.padEnd(8)} | ${plan} | ${memId} | ${run.updated_at}${warn}`
    );
  }

  return lines.join("\n");
}

export function cmdStatus(_args: string[]): void {
  const db = openDb();
  console.log(renderStatusTable(db));
}
