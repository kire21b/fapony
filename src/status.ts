import { openDb, getActiveRuns, getEvents, type Run, type Event } from "./db.js";

export function cmdStatus(_args: string[]): void {
  const db = openDb();
  const runs = getActiveRuns(db);

  if (runs.length === 0) {
    console.log("no active runs");
    return;
  }

  console.log("active runs:");
  console.log(
    "  id  | status          | round | worktree | updated_at"
  );
  console.log(
    "  ----|-----------------|-------|----------|-----------"
  );

  for (const run of runs) {
    const events = getEvents(db, run.id);
    const hasCommit = events.some((e) => e.kind === "commit");
    const hasMemoryEvent = events.some(
      (e) => e.kind === "memory_claim" || e.kind === "memory_claim_failed"
    );
    const warn =
      hasCommit && !hasMemoryEvent ? " ⚠ commit but no memory event" : "";

    console.log(
      `  ${String(run.id).padStart(3)} | ${run.status.padEnd(15)} | ${String(run.round).padStart(5)} | ${run.worktree.padEnd(8)} | ${run.updated_at}${warn}`
    );
  }
}
