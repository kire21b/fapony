import { openDb, getRun, setStatus, incrementRound, addEvent, loadConfig } from "./db.js";
import { closeMemory, kickoffMemory } from "./memory.js";

export async function cmdGate(args: string[]): Promise<void> {
  const runId = parseInt(args[0], 10);
  const verdict = args[1];
  const note = args.slice(2).join(" ");

  if (!runId || isNaN(runId) || (verdict !== "pass" && verdict !== "fail")) {
    console.error("usage: fapony gate <run-id> pass|fail [note]");
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

  const config = loadConfig();
  const worktree = config.worktrees[run.worktree] ?? ".";

  if (verdict === "pass") {
    setStatus(db, runId, "passed");
    addEvent(db, runId, "gate", { verdict: "pass", note });

    if (run.mem_id && config.memory) {
      closeMemory(config, worktree, run.mem_id, note || `run ${runId} passed`);
      addEvent(db, runId, "memory_claim_closed", { mem_id: run.mem_id });
    }

    console.log(`run ${runId} passed`);

    const kickoff = kickoffMemory(config, worktree);
    if (kickoff) {
      console.log("\n--- next (mem kickoff) ---");
      console.log(kickoff);
    }
    return;
  }

  // fail → back to executor, one more round
  incrementRound(db, runId);
  setStatus(db, runId, "fixing");
  addEvent(db, runId, "gate", { verdict: "fail", note });

  const updated = getRun(db, runId)!;
  console.log(`run ${runId} needs fixes (round ${updated.round}): ${note || "(no note)"}`);

  if (updated.round >= config.review.maxRounds) {
    console.log(
      `\n⚠ round ${updated.round} ≥ maxRounds ${config.review.maxRounds} — plan likely has a problem, not the code. Consider stopping and revising the plan instead of another fapony run.`
    );
  } else {
    console.log(`\nRe-run to fix: fapony run ${run.worktree} --plan ${run.plan ?? "<plan>"} --mem-id ${run.mem_id ?? "<id>"} --allow-dirty`);
  }
}
