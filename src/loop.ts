import {
  openDb,
  loadConfig,
  getRun,
  setStatus,
  addEvent,
  getLastPlanUpdate,
} from "./db.js";
import { runOnce, templateArgs } from "./run.js";
import { parseGateVerdict, parsePlanUpdate } from "./parse.js";
import { assertSafe } from "./safety.js";
import { closeMemory, kickoffMemory } from "./memory.js";
import { execSync } from "node:child_process";

/**
 * fapony loop — run executor → review → planner → repeat until FILE_DONE.
 *
 * Entry points:
 *   fapony loop <key> --plan <path>  → start new run
 *   fapony loop <run-id>             → resume after gate pass
 *
 * Flow per iteration:
 *   1. runOnce → awaiting_review → stop, print gate cmd for human
 *   2. Human gates pass → fapony loop <run-id> → resume
 *   3. If config has planner → spawn planner → get NEXT-PROMPT or FILE_DONE
 *   4. NEXT-PROMPT → runOnce with new prompt → goto 1
 *   5. FILE_DONE → close memory, kickoff next PLAN → done
 *   6. If no planner → stop at awaiting_review, tell human
 */
export async function cmdLoop(args: string[]): Promise<void> {
  const config = loadConfig();

  // --- Parse args ---
  const firstArg = args[0];
  let runId: number | null = null;
  let worktreeKey: string | null = null;
  let planPath: string | null = null;
  let memId: string | null = null;
  let allowDirty = false;

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

  // --- Resume mode: load run context ---
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
  if (!hasPlanner) {
    console.error("config.roles.planner not set — loop will stop at awaiting_review (no auto-planner)");
  }

  // --- Main loop ---
  while (true) {
    const currentRun = runId ? getRun(db, runId) : null;

    // --- awaiting_review: either stop (no planner) or spawn planner ---
    if (currentRun?.status === "awaiting_review") {
      if (!hasPlanner) {
        console.log(`\nrun ${runId} awaiting review — no planner configured, stopping loop`);
        console.log(`Review: fapony gate ${runId} pass|fail [note]`);
        break;
      }

      // Spawn planner
      console.error(`\n--- spawning planner for run ${runId} ---`);

      const planUpdate = await spawnPlanner(config, worktree, currentRun);
      if (!planUpdate) {
        console.error("planner produced no valid marker — stopping loop (§0.4 fail-safe)");
        break;
      }

      // Log plan event
      addEvent(db, runId, "plan", planUpdate);

      if (planUpdate.kind === "file_done") {
        // PLAN complete — close memory, kickoff next
        console.log(`\nFILE_DONE: ${planUpdate.text}`);
        if (memId) {
          closeMemory(config, worktree, memId, planUpdate.text);
          addEvent(db, runId, "memory_claim_closed", { mem_id: memId });
        }
        const kickoff = kickoffMemory(config, worktree);
        if (kickoff) console.log(`\n--- next PLAN ---\n${kickoff}`);
        break;
      }

      // NEXT-PROMPT → continue loop with new plan content
      console.error(`planner returned NEXT-PROMPT, starting next run...`);
      planPath = null; // plan comes from planner, not file
      runId = null; // will create new run
      // Fall through to runOnce below with planContent from planner
    }

    // --- Run executor ---
    // Resolve plan content: from planner event (if we just spawned) or from file
    let planContent: string | null = null;
    if (currentRun?.status === "awaiting_review" && hasPlanner) {
      // We just spawned planner above — use its output as plan content
      // (planPath was set to null, so runOnce will pick it up from getLastPlanUpdate)
    }

    const result = await runOnce({
      worktreeKey,
      planPath,
      planContent,
      memId,
      allowDirty: currentRun?.status === "fixing" ? true : allowDirty,
    });

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    runId = result.runId;

    if (result.status === "stalled") {
      console.error(`\nrun ${runId} stalled — cannot continue loop`);
      break;
    }

    // awaiting_review — stop and let human gate
    console.log(`\n--- awaiting review (run ${runId}) ---`);
    console.log(`Review: fapony gate ${runId} pass|fail [note]`);
    console.log(`Resume loop: fapony loop ${runId}`);
    break;
  }
}

async function spawnPlanner(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string }
): Promise<{ kind: "next_prompt" | "file_done"; text: string } | null> {
  const roleConfig = config.roles!.planner!;

  // Build planner prompt — simplified stdin with run context
  const stdin = `Run ID: ${run.id}
Worktree: ${run.worktree}
Memory ID: ${run.mem_id ?? "none"}

Review the current state and output your decision.`;

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd);

  try {
    const proc = Bun.spawn(cmd, {
      cwd: worktree,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(stdin);
    proc.stdin.end();

    // Collect stdout
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }

    // Stream stderr for visibility
    const errBuf = await new Response(proc.stderr).text();
    if (errBuf) process.stderr.write(errBuf);

    await proc.exited;

    return parsePlanUpdate(stdout);
  } catch (e) {
    console.error(`planner spawn failed: ${(e as Error).message}`);
    return null;
  }
}
