import { openDb, getRun, setStatus, addEvent, loadConfig } from "./db/index.js";
import { closeMemory } from "./memory.js";

export async function cmdStop(args: string[]): Promise<void> {
  const runId = parseInt(args[0], 10);
  const reason = args.slice(1).join(" ") || "stopped by user";

  if (!runId || isNaN(runId)) {
    console.error("usage: fapony stop <run-id> [reason]");
    process.exit(1);
  }

  const db = openDb();
  const run = getRun(db, runId);
  if (!run) {
    console.error(`run ${runId} not found`);
    process.exit(1);
  }

  if (run.status === "passed" || run.status === "stopped") {
    console.error(`run ${runId} is already ${run.status}`);
    process.exit(1);
  }

  setStatus(db, runId, "stopped");
  addEvent(db, runId, "stop", { reason });

  // Release memory if claimed
  if (run.mem_id) {
    const config = loadConfig();
    closeMemory(config, config.worktrees[run.worktree] ?? ".", run.mem_id, reason);
  }

  console.log(`run ${runId} stopped: ${reason}`);
}
