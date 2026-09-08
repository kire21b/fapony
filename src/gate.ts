import {
  addEvent,
  getRun,
  incrementRound,
  loadConfig,
  openDb,
  setStatus,
} from "./db/index.js";
import { closeMemory, kickoffMemory } from "./memory.js";
import { isPassFamily, VERDICT_GRADES, type VerdictGrade } from "./parse.js";

export interface GateResult {
  runId: number;
  status: "passed" | "fixing" | "stopped";
  round?: number;
  error?: string;
}

/**
 * Core gate logic — does NOT call process.exit.
 * CLI wrapper (cmdGate) is responsible for exit codes.
 *
 * Verdict routing (3 groups):
 *   pass-family (pass-excellent|pass-good|pass-adequate|pass) → passed
 *   fail → fixing (+ round cap check)
 *   uncertain → stopped (same shape as round-cap path)
 */
export function gateOnce(
  runId: number,
  verdict: VerdictGrade,
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

  // --- pass family (4 grades) ---
  if (isPassFamily(verdict)) {
    setStatus(db, runId, "passed");
    addEvent(db, runId, "gate", { verdict, note, round: run.round });

    if (run.mem_id && config.memory) {
      closeMemory(config, worktree, run.mem_id, note || `run ${runId} passed`);
      addEvent(db, runId, "memory_claim_closed", { mem_id: run.mem_id });
    }

    const kickoff = kickoffMemory(config, worktree);
    if (kickoff) console.log(kickoff);

    return { runId, status: "passed" };
  }

  // --- uncertain → stop (plan problem, same as round-cap) ---
  if (verdict === "uncertain") {
    setStatus(db, runId, "stopped");
    addEvent(db, runId, "gate", { verdict, note, round: run.round });
    addEvent(db, runId, "stop", { reason: "verdict_uncertain" });

    if (run.mem_id) {
      closeMemory(
        config,
        worktree,
        run.mem_id,
        `run ${runId} stopped — uncertain verdict`,
      );
      addEvent(db, runId, "memory_claim_closed", { mem_id: run.mem_id });
    }
    return { runId, status: "stopped" };
  }

  // --- fail → back to executor, one more round ---
  incrementRound(db, runId);
  setStatus(db, runId, "fixing");
  addEvent(db, runId, "gate", { verdict, note, round: run.round });

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
  const rawVerdict = args[1];

  if (!runId || Number.isNaN(runId) || !rawVerdict) {
    console.error("usage: fapony gate <run-id> <grade> [note]");
    console.error(`       grade: ${[...VERDICT_GRADES].join(" | ")}`);
    console.error(
      "       (long/multiline note? pipe it via stdin instead, e.g. `fapony gate 1 fail < findings.md`)",
    );
    process.exit(1);
  }

  if (!VERDICT_GRADES.has(rawVerdict)) {
    console.error(`unknown grade: ${rawVerdict}`);
    console.error(`valid grades: ${[...VERDICT_GRADES].join(", ")}`);
    process.exit(1);
  }

  const verdict = rawVerdict as VerdictGrade;
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
  } else if (result.status === "stopped") {
    console.log(`run ${runId} stopped — uncertain verdict`);
  }
}
