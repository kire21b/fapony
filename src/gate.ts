import {
  addEvent,
  getRun,
  incrementRound,
  loadConfig,
  openDb,
  setStatus,
} from "./db/index.js";
import { closeMemory, kickoffMemory } from "./memory.js";

export interface GateResult {
  runId: number;
  status: "passed" | "fixing" | "stopped";
  round?: number;
  error?: string;
}

/**
 * Core gate logic — does NOT call process.exit.
 * CLI wrapper (cmdGate) is responsible for exit codes.
 */
export function gateOnce(
  runId: number,
  verdict: "pass" | "fail",
  note: string,
): GateResult {
  const db = openDb();
  const run = getRun(db, runId);
  if (!run) {
    return { runId, status: "stopped", error: `run ${runId} not found` };
  }
  if (run.status === "passed" || run.status === "stopped") {
    return {
      runId,
      status: run.status,
      error: `run ${runId} is already ${run.status}`,
    };
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

    const kickoff = kickoffMemory(config, worktree);
    if (kickoff) console.log(kickoff);

    return { runId, status: "passed" };
  }

  // fail → back to executor, one more round
  incrementRound(db, runId);
  setStatus(db, runId, "fixing");
  addEvent(db, runId, "gate", { verdict: "fail", note });

  const updated = getRun(db, runId);
  if (!updated) {
    setStatus(db, runId, "stopped");
    return {
      runId,
      status: "stopped",
      error: `run ${runId} disappeared after update`,
    };
  }

  if (updated.round > config.review.maxRounds) {
    // Round cap reached — the plan is the problem, stop for real. Persist it
    // (else the run sits in 'fixing' forever) and release the memory claim.
    setStatus(db, runId, "stopped");
    addEvent(db, runId, "stop", {
      reason: `round ${updated.round} > maxRounds ${config.review.maxRounds}`,
    });
    if (run.mem_id) {
      closeMemory(
        config,
        worktree,
        run.mem_id,
        `run ${runId} stopped at round cap`,
      );
      addEvent(db, runId, "memory_claim_closed", { mem_id: run.mem_id });
    }
    return {
      runId,
      status: "stopped",
      round: updated.round,
      error: `round ${updated.round} > maxRounds ${config.review.maxRounds} — plan likely has a problem`,
    };
  }

  return { runId, status: "fixing", round: updated.round };
}

/** CLI wrapper — parses args, calls gateOnce, handles exit. */
export async function cmdGate(args: string[]): Promise<void> {
  const runId = parseInt(args[0], 10);
  const verdict = args[1];

  if (
    !runId ||
    Number.isNaN(runId) ||
    (verdict !== "pass" && verdict !== "fail")
  ) {
    console.error("usage: fapony gate <run-id> pass|fail [note]");
    console.error(
      "       (long/multiline note? pipe it via stdin instead, e.g. `fapony gate 1 fail < findings.md`)",
    );
    process.exit(1);
  }

  const inline = args.slice(2).join(" ");
  const note =
    inline || (process.stdin.isTTY ? "" : await Bun.stdin.text()).trim();

  const result = gateOnce(runId, verdict, note);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status === "passed") {
    console.log(`run ${runId} passed`);
  } else if (result.status === "fixing") {
    console.log(
      `run ${runId} needs fixes (round ${result.round}): ${note || "(no note)"}`,
    );
  }
}
