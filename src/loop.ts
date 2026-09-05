import {
  openDb,
  loadConfig,
  getRun,
  setStatus,
  addEvent,
  roleTimeoutMin,
  safetyDeny,
  shippedRE,
  archiveMsg,
  inboundWarnAt,
  promptFileFor,
  handoffMarker,
  type Config,
} from "./db.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { runOnce } from "./run.js";
import { templateArgs, fillPrompt } from "./util.js";
import { gateOnce } from "./gate.js";
import { parseGateVerdict, parsePlanUpdate } from "./parse.js";
import { assertSafe } from "./safety.js";
import { closeMemory, kickoffMemory } from "./memory.js";
import { renderHandoff } from "./handoff.js";
import { planMv, type PlanMvResult } from "./planmv.js";

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
  // Planner NEXT-PROMPT text for the upcoming executor round (consumed once).
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

      addEvent(db, runId, "plan", planUpdate);

      if (planUpdate.kind === "file_done") {
        console.log(`\nFILE_DONE: ${planUpdate.text}`);
        if (memId) {
          closeMemory(config, worktree, memId, planUpdate.text);
          addEvent(db, runId, "memory_claim_closed", { mem_id: memId });
        }

        if (afterGate.plan) {
          const archived = autoArchivePlan(worktree, afterGate.plan, config);
          if (archived.ok) {
            console.log(`archived: .fapony/plan/done/${afterGate.plan.split("/").pop()}`);
            addEvent(db, runId, "plan_archived", { plan: afterGate.plan });
          } else {
            console.error(`auto plan-mv skipped: ${archived.error}`);
            console.error(`Check ${worktree} — archive/commit manually if needed (fapony plan-mv <path> if it's still in .fapony/plan/)`);
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

async function spawnGate(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string }
): Promise<{ verdict: "pass" | "fail"; note: string } | null> {
  const roleConfig = config.roles!.gate!;

  const stdin = renderRolePrompt(config, "gate", `Review run ${run.id} for worktree ${run.worktree}.`, {
    RUN_ID: String(run.id),
    WORKTREE: run.worktree,
    MEM_ID: run.mem_id ?? "none",
  });

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd, safetyDeny(config));

  const timeoutMs = roleTimeoutMin(config, "gate") * 60 * 1000;

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

    return parseGateVerdict(stdout, config);
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

  const fallback = `Run ID: ${run.id}
Worktree: ${run.worktree}
Memory ID: ${run.mem_id ?? "none"}

Review the current state and output your decision.`;
  const stdin = renderRolePrompt(config, "planner", fallback, {
    RUN_ID: String(run.id),
    WORKTREE: run.worktree,
    MEM_ID: run.mem_id ?? "none",
  });

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd, safetyDeny(config));

  const timeoutMs = roleTimeoutMin(config, "planner") * 60 * 1000;

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

    return parsePlanUpdate(stdout, config);
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

  const fallback = `Big diff detected: ${runResult.facts.files} files, ${runResult.facts.lines} lines.
Fix any issues found. Output HANDOFF when done.`;
  const stdin = renderRolePrompt(config, "bigFixer", fallback, {
    FILES: String(runResult.facts.files),
    LINES: String(runResult.facts.lines),
    BRANCH: runResult.facts.branch,
    HANDOFF: handoffMarker(config),
  });

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd, safetyDeny(config));

  const timeoutMs = roleTimeoutMin(config, "bigFixer") * 60 * 1000;

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

/**
 * Routing predicate for the scrutinize-fix lane — the small-diff mirror of
 * the `result.isBig && roles.bigFixer` branch above. Extracted (not inlined)
 * so tests assert the real branch condition, not a copy of it.
 */
export function shouldScrutinizeFix(
  result: { isBig: boolean; status: string },
  config: Config
): boolean {
  return !result.isBig && !!config.roles?.scrutinizeFix && result.status === "awaiting_review";
}

/**
 * Resolves the changed-file list for the prompt via base_sha..HEAD.
 * Falls back to sentinel strings when the base is unknown or the diff is empty.
 */
export function resolveChangedFiles(worktree: string, baseSha: string | null | undefined): string {
  if (!baseSha) return "(unknown — base sha unavailable)";
  try {
    return (
      execSync(`git diff --name-only ${baseSha}..HEAD -- .`, {
        cwd: worktree,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || "(none)"
    );
  } catch {
    return "(unknown — base sha unavailable)";
  }
}

/**
 * Builds the scrutinize-fix stdin: role prompt template + run context header.
 * The template alone carries no diff info, so the header supplies what the
 * role prompt requires (changed files + repo_root).
 */
export function buildScrutinizePrompt(
  worktree: string,
  runResult: { runId: number; facts: { files: number; lines: number; commits: string[]; branch: string } },
  changedFiles: string,
  config?: Config
): string {
  const promptPath =
    (config ? promptFileFor(config, "scrutinizeFix") : null) ??
    join(import.meta.dir, "..", "prompts", "scrutinize-fix.md");
  const template = readFileSync(promptPath, "utf-8");
  return `${template}\n\n---\nRun ID: ${runResult.runId}\nrepo_root="${worktree}"\nChanged files (use these, do not auto-detect):\n${changedFiles}\nChanged: ${runResult.facts.files} files, ${runResult.facts.lines} lines, branch ${runResult.facts.branch}, commits ${runResult.facts.commits.join(", ") || "(none)"}\nReview the changed code then fix MAJOR/BLOCKER in place and commit.`;
}

/**
 * Render a role prompt: when prompts.<role> points at a template file, fill
 * its {{VARS}}; otherwise use the builtin inline fallback. A missing/unreadable
 * file falls back instead of crashing the loop.
 */
export function renderRolePrompt(
  config: Config,
  role: "gate" | "planner" | "bigFixer",
  fallback: string,
  vars: Record<string, string>
): string {
  const file = promptFileFor(config, role);
  if (!file) return fallback;
  try {
    return fillPrompt(readFileSync(file, "utf-8"), vars);
  } catch {
    console.error(`prompt file unreadable: ${file} — using builtin fallback`);
    return fallback;
  }
}

/**
 * Auto-archive a shipped PLAN via planMv() — the FILE_DONE mirror of
 * bigFixer/scrutinizeFix's "reuse-not-rebuild" wiring.
 *
 * planMv() requires a file-level shipped header (`> ✅ **shipped** (<hash>)`)
 * at the top of the file; the planner only marks individual items shipped
 * inline (prompts/planner.md), so that header never exists yet at FILE_DONE
 * time. This synthesizes it from the current HEAD before calling planMv(),
 * then commits the archive (rename + header) in one step — deterministic,
 * no agent involved.
 */
export function autoArchivePlan(worktree: string, planRelPath: string, config?: Config): PlanMvResult {
  const filePath = join(worktree, planRelPath);
  const shipped = shippedRE(config);
  let hash: string;
  try {
    const content = readFileSync(filePath, "utf-8");
    if (!shipped.test(content)) {
      hash = execSync("git rev-parse --short HEAD", { cwd: worktree, encoding: "utf-8" }).trim();
      writeFileSync(filePath, `> ✅ **shipped** (${hash})\n\n${content}`, "utf-8");
    } else {
      hash = "existing";
    }
  } catch (e) {
    return { ok: false, error: `cannot prepare shipped header: ${(e as Error).message}` };
  }

  const result = planMv(filePath, { repoRoot: worktree, config });
  if (!result.ok) return result;

  try {
    const fileName = planRelPath.split("/").pop();
    const msg = config ? archiveMsg(config, fileName!, hash) : `chore(plan): archive ${fileName} (shipped ${hash})`;
    execSync(`git commit -m "${msg.replace(/"/g, "'")}"`, {
      cwd: worktree,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    // git mv already happened — report but don't undo it; dev commits manually
    // (not "run fapony plan-mv again" — the file is already at its new path).
    return {
      ...result,
      ok: false,
      error: `moved to .fapony/plan/done/ but commit failed: ${(e as Error).message} — run: git commit`,
    };
  }

  return result;
}

export async function spawnScrutinizeFix(
  config: Config,
  worktree: string,
  runResult: { runId: number; facts: { files: number; lines: number; commits: string[]; branch: string }; parsed: { missing: boolean; checks?: string } }
): Promise<string | null> {
  const roleConfig = config.roles!.scrutinizeFix!;

  const db = openDb();
  const run = getRun(db, runResult.runId);
  const changedFiles = resolveChangedFiles(worktree, run?.base_sha);

  const stdin = buildScrutinizePrompt(worktree, runResult, changedFiles, config);

  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd, safetyDeny(config));

  const timeoutMs = roleTimeoutMin(config, "scrutinizeFix") * 60 * 1000;

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
    console.error(`scrutinizeFix spawn failed: ${(e as Error).message}`);
    return null;
  }
}
