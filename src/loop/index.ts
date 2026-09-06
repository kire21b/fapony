// src/loop/index.ts — fapony loop: run executor → review → planner → repeat until FILE_DONE.
//
// Entry points:
//   fapony loop <key> --plan <path>  → start new run
//   fapony loop <run-id>             → resume after gate pass
//
// When autoLoop: true + roles.gate exists:
//   Loop spawns gate agent automatically instead of waiting for human.

import { loadConfig, openDb, getRun, addEvent, type Config } from "../db/index.js";
import { runOnce } from "../run/index.js";
import { gateOnce } from "../gate.js";
import { closeMemory, kickoffMemory } from "../memory.js";
import { spawnGate, spawnPlanner, spawnBigFixer, spawnScrutinizeFix } from "./spawn.js";
import { shouldScrutinizeFix } from "./scrutinize.js";
import { autoArchivePlan } from "./archive.js";

// Re-export public symbols for backward compatibility (src/loop.ts shim)
export * from "./prompt.js";
export * from "./scrutinize.js";
export * from "./archive.js";
export { spawnScrutinizeFix } from "./spawn.js";

export async function cmdLoop(args: string[]): Promise<void> {
  const config = loadConfig();

  // --- Parse args ---
  const firstArg = args[0];
  let runId: number | null = null;
  let worktreeKey: string | null = null;
  let planPath: string | null = null;
  let memId: string | null = null;
  let allowDirty = false;
  let nextPlanContent: string | null = null;

  if (firstArg && /^\d+$/.test(firstArg)) {
    runId = parseInt(firstArg, 10);
  } else {
    worktreeKey = firstArg ?? null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--plan" && args[i + 1]) {
        planPath = args[++i];
      } else if (args[i] === "--mem-id" && args[i + 1]) {
        memId = args[++i];
      } else if (args[i] === "--allow-dirty") {
        allowDirty = true;
      }
    }
  }

  const db = openDb();

  // --- Resume mode ---
  if (runId) {
    const run = getRun(db, runId);
    if (!run) {
      console.error(`run ${runId} not found`);
      process.exit(1);
    }
    worktreeKey = run.worktree;
    planPath = run.plan;
    memId = run.mem_id;

    if (run.status === "passed" || run.status === "stopped" || run.status === "stalled") {
      console.error(`run ${runId} is already ${run.status}`);
      process.exit(0);
    }
  }

  if (!worktreeKey) {
    console.error("usage: fapony loop <worktree-key> --plan <path> [--mem-id <id>]");
    process.exit(1);
  }

  const worktree = config.worktrees[worktreeKey];
  if (!worktree) {
    console.error(`unknown worktree key: ${worktreeKey}`);
    process.exit(1);
  }

  const hasPlanner = !!config.roles?.planner;
  const autoLoop = !!config.review?.autoLoop;
  const hasGate = !!config.roles?.gate;

  if (!hasPlanner) {
    console.error("config.roles.planner not set — loop will stop at awaiting_review");
  }
  if (autoLoop && !hasGate) {
    console.error("config.review.autoLoop is true but no roles.gate — auto-gate disabled");
  }

  // --- Main loop ---
  while (true) {
    const currentRun = runId ? getRun(db, runId) : null;

    // --- awaiting_review ---
    if (currentRun?.status === "awaiting_review") {
      // Auto-gate: spawn gate agent
      if (autoLoop && hasGate) {
        console.error(`\n--- auto-gate for run ${runId} ---`);

        const gateResult = await spawnGate(config, worktree, currentRun);
        if (!gateResult) {
          console.error("gate produced no VERDICT — stopping loop (§0.4 fail-safe)");
          break;
        }

        const gateOutcome = gateOnce(runId!, gateResult.verdict, gateResult.note);
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
          console.log(`\nrun ${runId} awaiting review — stopping loop (no planner)`);
          console.log(`Review: fapony gate ${runId} pass|fail [note]`);
          break;
        }
        console.log(`\nrun ${runId} awaiting review`);
        console.log(`Review: fapony gate ${runId} pass|fail [note]`);
        console.log(`Resume loop: fapony loop ${runId}`);
        break;
      }
    }

    // --- After gate pass: spawn planner ---
    const afterGate = runId ? getRun(db, runId) : null;
    if (afterGate?.status === "passed" && hasPlanner) {
      console.error(`\n--- spawning planner for run ${runId} ---`);

      const planUpdate = await spawnPlanner(config, worktree, afterGate);
      if (!planUpdate) {
        console.error("planner produced no valid marker — stopping loop (§0.4 fail-safe)");
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
            console.log(`archived: .fapony/plan/done/${afterGate.plan.split("/").pop()}`);
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
    });
    nextPlanContent = null;

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    runId = result.runId;

    if (result.status === "stalled") {
      console.error(`\nrun ${runId} stalled — cannot continue loop`);
      break;
    }

    // --- Big diff route: spawn bigFixer instead of planner ---
    // NOTE: bigFixer is fire-and-forget — it fixes and commits, then the loop
    // continues to re-run executor. The fixerResult is not parsed or reviewed
    // in this pass; the next executor run will pick up the fixes.
    if (result.isBig && config.roles?.bigFixer) {
      console.error(
        `\n--- big diff route (${result.facts.files} files, ${result.facts.lines} lines) — spawning bigFixer ---`,
      );

      const fixerResult = await spawnBigFixer(config, worktree, result);
      if (!fixerResult) {
        console.error("bigFixer produced no output — stopping loop");
        break;
      }

      if (autoLoop && hasGate) {
        const gateResult = await spawnGate(config, worktree, { id: runId!, mem_id: memId, worktree: worktreeKey! });
        if (gateResult) {
          gateOnce(runId!, gateResult.verdict, gateResult.note);
        }
      }
      continue;
    }

    // --- Small diff route: scrutinize-fix pass before gate ---
    // NOTE: symmetric to bigFixer but no continue — falls through to the
    // awaiting_review block below so the normal gate logic (auto/manual)
    // reviews the already-fixed diff. Fire-and-forget like bigFixer:
    // commits its own fixes, failure here never blocks the gate.
    if (shouldScrutinizeFix(result, config)) {
      console.error(`\n--- scrutinize-fix pass for run ${runId} ---`);
      const fixed = await spawnScrutinizeFix(config, worktree, result);
      if (!fixed) {
        console.error("scrutinize-fix produced no output — continuing to gate with original diff");
      }
    }

    // awaiting_review — loop back to top
    if (result.status === "awaiting_review") {
      console.log(`\nrun ${runId} awaiting review`);
      if (!autoLoop || !hasGate) {
        console.log(`Review: fapony gate ${runId} pass|fail [note]`);
        console.log(`Resume loop: fapony loop ${runId}`);
        break;
      }
      // autoLoop: continue to top of loop to auto-gate
      continue;
    }
  }
}
