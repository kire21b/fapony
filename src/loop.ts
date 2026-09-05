import {
  openDb,
  loadConfig,
  getRun,
  setStatus,
  addEvent,
  getLastPlanUpdate,
  type Config,
} from "./db.js";
import { runOnce } from "./run.js";
import { templateArgs } from "./util.js";
import { gateOnce } from "./gate.js";
import { parseGateVerdict, parsePlanUpdate } from "./parse.js";
import { assertSafe } from "./safety.js";
import { closeMemory, kickoffMemory } from "./memory.js";
import { renderHandoff } from "./handoff.js";

/**
 * fapony loop — run executor → review → planner → repeat until FILE_DONE.
 *
 * Entry points:
 *   fapony loop <key> --plan <path>  → start new run
 *   fapony loop <run-id>             → resume after gate pass
 *
 * When autoLoop: true + roles.gate exists:
 *   Loop spawns gate agent automatically instead of waiting for human.
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

      addEvent(db, runId, "plan", planUpdate);

      if (planUpdate.kind === "file_done") {
        console.log(`\nFILE_DONE: ${planUpdate.text}`);
        if (memId) {
          closeMemory(config, worktree, memId, planUpdate.text);
          addEvent(db, runId, "memory_claim_closed", { mem_id: memId });
        }
        const kickoff = kickoffMemory(config, worktree);
        if (kickoff) console.log(`\n--- next PLAN ---\n${kickoff}`);
        break;
      }

      // NEXT-PROMPT → run executor with new plan
      console.error(`planner returned NEXT-PROMPT, starting next run...`);
      planPath = null;
      runId = null;
    }

    // --- Run executor ---
    const result = await runOnce({
      worktreeKey,
      planPath,
      planContent: null,
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

    // --- Big diff route: spawn bigFixer instead of planner ---
    // NOTE: bigFixer is fire-and-forget — it fixes and commits, then the loop
    // continues to re-run executor. The fixerResult is not parsed or reviewed
    // in this pass; the next executor run will pick up the fixes.
    if (result.isBig && config.roles?.bigFixer) {
      console.error(`\n--- big diff route (${result.facts.files} files, ${result.facts.lines} lines) — spawning bigFixer ---`);

      const fixerResult = await spawnBigFixer(config, worktree, result);
      if (!fixerResult) {
        console.error("bigFixer produced no output — stopping loop");
        break;
      }

      if (autoLoop && hasGate) {
        const gateResult = await spawnGate(config, worktree, { id: runId, mem_id: memId, worktree: worktreeKey! });
        if (gateResult) {
          gateOnce(runId, gateResult.verdict, gateResult.note);
        }
      }
      continue;
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

async function spawnGate(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string }
): Promise<{ verdict: "pass" | "fail"; note: string } | null> {
  const roleConfig = config.roles!.gate!;

  const stdin = `Review run ${run.id} for worktree ${run.worktree}.`;

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd);

  const timeoutMs = (roleConfig.timeoutMin ?? 10) * 60 * 1000;

  try {
    const proc = Bun.spawn(cmd, {
      cwd: worktree,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(stdin);
    proc.stdin.end();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";

    const timeout = setTimeout(() => proc.kill(), timeoutMs);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }

    clearTimeout(timeout);
    const errBuf = await new Response(proc.stderr).text();
    if (errBuf) process.stderr.write(errBuf);

    await proc.exited;

    return parseGateVerdict(stdout);
  } catch (e) {
    console.error(`gate spawn failed: ${(e as Error).message}`);
    return null;
  }
}

async function spawnPlanner(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string }
): Promise<{ kind: "next_prompt" | "file_done"; text: string } | null> {
  const roleConfig = config.roles!.planner!;

  const stdin = `Run ID: ${run.id}
Worktree: ${run.worktree}
Memory ID: ${run.mem_id ?? "none"}

Review the current state and output your decision.`;

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd);

  const timeoutMs = (roleConfig.timeoutMin ?? 10) * 60 * 1000;

  try {
    const proc = Bun.spawn(cmd, {
      cwd: worktree,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(stdin);
    proc.stdin.end();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";

    const timeout = setTimeout(() => proc.kill(), timeoutMs);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }

    clearTimeout(timeout);
    const errBuf = await new Response(proc.stderr).text();
    if (errBuf) process.stderr.write(errBuf);

    await proc.exited;

    return parsePlanUpdate(stdout);
  } catch (e) {
    console.error(`planner spawn failed: ${(e as Error).message}`);
    return null;
  }
}

async function spawnBigFixer(
  config: Config,
  worktree: string,
  runResult: { facts: { files: number; lines: number; commits: string[]; branch: string }; parsed: { missing: boolean; checks?: string } }
): Promise<string | null> {
  const roleConfig = config.roles!.bigFixer!;

  const stdin = `Big diff detected: ${runResult.facts.files} files, ${runResult.facts.lines} lines.
Fix any issues found. Output HANDOFF when done.`;

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd);

  const timeoutMs = (roleConfig.timeoutMin ?? 20) * 60 * 1000;

  try {
    const proc = Bun.spawn(cmd, {
      cwd: worktree,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(stdin);
    proc.stdin.end();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";

    const timeout = setTimeout(() => proc.kill(), timeoutMs);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }

    clearTimeout(timeout);
    const errBuf = await new Response(proc.stderr).text();
    if (errBuf) process.stderr.write(errBuf);

    await proc.exited;

    return stdout || null;
  } catch (e) {
    console.error(`bigFixer spawn failed: ${(e as Error).message}`);
    return null;
  }
}
