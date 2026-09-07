// src/loop/index.ts — runLoop: run executor → review → planner → repeat until FILE_DONE.
//
// Entry point: runLoop() called from cmdRun with --loop flag.
//
// When autoLoop: true + roles.gate exists:
//   Loop spawns gate agent automatically instead of waiting for human.

import { execSync } from "node:child_process";
import { addEvent, getRun, loadConfig, openDb } from "../db/index.js";
import { gateOnce } from "../gate.js";
import { closeMemory, kickoffMemory } from "../memory.js";
import { runOnce } from "../run/index.js";
import { isSigintReceived, setSigintPhase, setSigintRunId } from "../sigint.js";
import { autoArchivePlan } from "./archive.js";
import { shouldScrutinizeFix } from "./scrutinize.js";
import {
  spawnBigFixer,
  spawnGate,
  spawnPlanner,
  spawnScrutinizeFix,
} from "./spawn.js";

export * from "./archive.js";
export * from "./prompt.js";
export * from "./scrutinize.js";
export { spawnScrutinizeFix } from "./spawn.js";

/**
 * Check if the current run has been stopped (by `fapony stop` from another terminal)
 * or SIGINT received. Used by retry loops to abort between attempts.
 */
async function isRunAborted(
  db: ReturnType<typeof openDb>,
  runId: number | null,
): Promise<boolean> {
  if (isSigintReceived()) return true;
  if (!runId) return false;
  const run = getRun(db, runId);
  return run?.status === "stopped";
}

export interface RunLoopOpts {
  worktreeKey: string;
  planPath: string | null;
  memId: string | null;
  allowDirty: boolean;
  runId?: number | null;
}

/**
 * Core loop driver — run executor → review → planner → repeat until FILE_DONE.
 * Does NOT call process.exit; throws on fatal errors.
 */
export async function runLoop(opts: RunLoopOpts): Promise<void> {
  const config = loadConfig();
  let { worktreeKey, planPath, memId, allowDirty } = opts;
  let runId = opts.runId ?? null;
  let nextPlanContent: string | null = null;

  const db = openDb();

  const worktree = config.worktrees[worktreeKey];
  if (!worktree) {
    throw new Error(`unknown worktree key: ${worktreeKey}`);
  }

  const hasPlanner = !!config.roles?.planner;
  const autoLoop = !!config.review?.autoLoop;
  const hasGate = !!config.roles?.gate;

  if (!hasPlanner) {
    console.error(
      "config.roles.planner not set — loop will stop at awaiting_review",
    );
  }
  if (autoLoop && !hasGate) {
    console.error(
      "config.review.autoLoop is true but no roles.gate — auto-gate disabled",
    );
  }

  // --- Main loop ---
  while (true) {
    const currentRun = runId ? getRun(db, runId) : null;

    // --- awaiting_review ---
    if (currentRun?.status === "awaiting_review") {
      // Auto-gate: spawn gate agent
      if (autoLoop && hasGate) {
        console.error(`\n--- auto-gate for run ${runId} ---`);

        const gateResult = await spawnGate(config, worktree, currentRun, () =>
          isRunAborted(db, runId),
        );
        if (!gateResult) {
          console.error(
            "gate produced no VERDICT — stopping loop (§0.4 fail-safe)",
          );
          break;
        }

        const gateOutcome = gateOnce(
          runId!,
          gateResult.verdict,
          gateResult.note,
        );
        console.log(`gate: ${gateResult.verdict} — ${gateOutcome.status}`);

        if (gateOutcome.status === "passed") {
          // Continue to planner
        } else if (gateOutcome.status === "fixing") {
          // Continue loop — will re-run executor with feedback
        } else {
          // stopped (maxRounds)
          console.error(`run ${runId} stopped: ${gateOutcome.error}`);
          break;
        }
      } else {
        // Manual gate: stop and wait for human
        if (!hasPlanner) {
          console.log(
            `\nrun ${runId} awaiting review — stopping loop (no planner)`,
          );
          console.log(`Review: fapony gate ${runId} pass|fail [note]`);
          break;
        }
        console.log(`\nrun ${runId} awaiting review`);
        console.log(`Review: fapony gate ${runId} pass|fail [note]`);
        console.log(`Resume loop: fapony run ${runId} --loop`);
        break;
      }
    }

    // --- After gate pass: spawn planner ---
    const afterGate = runId ? getRun(db, runId) : null;
    if (afterGate?.status === "passed" && hasPlanner) {
      console.error(`\n--- spawning planner for run ${runId} ---`);

      const planUpdate = await spawnPlanner(config, worktree, afterGate, () =>
        isRunAborted(db, runId),
      );
      if (!planUpdate) {
        console.error(
          "planner produced no valid marker — stopping loop (§0.4 fail-safe)",
        );
        break;
      }

      addEvent(db, runId!, "plan", planUpdate);

      if (planUpdate.kind === "file_done") {
        console.log(`\nFILE_DONE: ${planUpdate.text}`);
        if (memId) {
          closeMemory(config, worktree, memId, planUpdate.text);
          addEvent(db, runId!, "memory_claim_closed", { mem_id: memId });
        }

        if (afterGate.plan) {
          const archived = autoArchivePlan(worktree, afterGate.plan, config);
          if (archived.ok) {
            console.log(
              `archived: .fapony/plan/done/${afterGate.plan.split("/").pop()}`,
            );
            addEvent(db, runId!, "plan_archived", { plan: afterGate.plan });
          } else {
            console.error(`auto plan-mv skipped: ${archived.error}`);
            console.error(
              `Check ${worktree} — archive/commit manually if needed (fapony plan-mv <path> if it's still in .fapony/plan/)`,
            );
          }
        }

        const kickoff = kickoffMemory(config, worktree);
        if (kickoff) console.log(`\n--- next PLAN ---\n${kickoff}`);
        break;
      }

      // NEXT-PROMPT → run executor with the planner's text as the plan
      console.error(`planner returned NEXT-PROMPT, starting next run...`);
      nextPlanContent = planUpdate.text;
      planPath = null;
      runId = null;
    }

    // --- Run executor ---
    const result = await runOnce({
      worktreeKey,
      planPath,
      planContent: nextPlanContent,
      memId,
      allowDirty: currentRun?.status === "fixing" ? true : allowDirty,
      isAborted: () => isRunAborted(db, runId),
    });
    nextPlanContent = null;

    if (result.error) {
      throw new Error(result.error);
    }

    runId = result.runId;
    setSigintRunId(runId);

    if (result.status === "stalled") {
      console.error(`\nrun ${runId} stalled — cannot continue loop`);
      break;
    }

    // --- Big diff route: spawn bigFixer instead of planner ---
    if (result.isBig && config.roles?.bigFixer) {
      console.error(
        `\n--- big diff route (${result.facts.files} files, ${result.facts.lines} lines) — spawning bigFixer ---`,
      );

      const fixerResult = await spawnBigFixer(config, worktree, result, () =>
        isRunAborted(db, runId),
      );
      if (!fixerResult) {
        console.error("bigFixer produced no output — stopping loop");
        break;
      }

      // Verify bigFixer actually committed changes
      try {
        const dirty = execSync("git status --porcelain", {
          cwd: worktree,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 10_000,
        }).trim();
        if (dirty) {
          console.error(
            `bigFixer left uncommitted changes — stopping loop to avoid spin`,
          );
          break;
        }
      } catch {
        // git status failed — continue to gate, not fatal
      }

      if (autoLoop && hasGate) {
        const gateResult = await spawnGate(
          config,
          worktree,
          {
            id: runId!,
            mem_id: memId,
            worktree: worktreeKey!,
          },
          () => isRunAborted(db, runId),
        );
        if (gateResult) {
          gateOnce(runId!, gateResult.verdict, gateResult.note);
        }
      }
      continue;
    }

    // --- Small diff route: scrutinize-fix pass before gate ---
    if (shouldScrutinizeFix(result, config)) {
      console.error(`\n--- scrutinize-fix pass for run ${runId} ---`);
      const fixed = await spawnScrutinizeFix(config, worktree, result, () =>
        isRunAborted(db, runId),
      );
      if (!fixed) {
        console.error(
          "scrutinize-fix produced no output — continuing to gate with original diff",
        );
      } else {
        // Verify it actually committed changes
        try {
          const dirty = execSync("git status --porcelain", {
            cwd: worktree,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 10_000,
          }).trim();
          if (dirty) {
            console.error(
              "scrutinize-fix produced output but left uncommitted changes — continuing to gate with original diff",
            );
          }
        } catch {
          // git status failed — not fatal
        }
      }
    }

    // awaiting_review — loop back to top
    if (result.status === "awaiting_review") {
      console.log(`\nrun ${runId} awaiting review`);
      if (!autoLoop || !hasGate) {
        console.log(`Review: fapony gate ${runId} pass|fail [note]`);
        console.log(`Resume loop: fapony run ${runId} --loop`);
        break;
      }
    }
  }

  // Clean up SIGINT handler state
  setSigintRunId(null);
  setSigintPhase("spawn");
}
