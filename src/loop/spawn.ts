// src/loop/spawn.ts — generic agent spawn + role-specific wrappers for gate/planner/bigFixer/scrutinizeFix.

import { openDb, getRun, roleTimeoutMin, safetyDeny, handoffMarker, type Config } from "../db/index.js";
import { renderRolePrompt } from "./prompt.js";
import { buildScrutinizePrompt, resolveChangedFiles } from "./scrutinize.js";
import { templateArgs } from "../util.js";
import { assertSafe } from "../safety.js";
import { parseGateVerdict, parsePlanUpdate } from "../parse.js";
import { beginSpawn, endSpawn } from "../cost.js";

/**
 * Generic agent spawn — renders stdin, runs assertSafe (outside try so
 * dangerous commands throw loudly), spawns Bun, drains stdout+stderr with
 * timeout, and completes the cost-tracking event row.
 *
 * Returns stdout on success, or null on spawn failure/empty output.
 */
async function runSpawn(
  config: Config,
  worktree: string,
  runId: number,
  role: string,
  stdin: string
): Promise<string | null> {
  const roleConfig = config.roles![role]!;
  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd, safetyDeny(config));

  const timeoutMs = roleTimeoutMin(config, role) * 60 * 1000;
  const db = openDb();
  const spawnEventId = beginSpawn(db, runId, config, role, stdin);

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

    endSpawn(db, spawnEventId, config, role, stdout);
    return stdout || null;
  } catch (e) {
    console.error(`${role} spawn failed: ${(e as Error).message}`);
    endSpawn(db, spawnEventId, config, role, "");
    return null;
  }
}

// --- Role-specific wrappers (build stdin + call runSpawn) ---

export async function spawnGate(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string }
): Promise<{ verdict: "pass" | "fail"; note: string } | null> {
  const stdin = renderRolePrompt(config, "gate", `Review run ${run.id} for worktree ${run.worktree}.`, {
    RUN_ID: String(run.id),
    WORKTREE: run.worktree,
    MEM_ID: run.mem_id ?? "none",
  });

  const stdout = await runSpawn(config, worktree, run.id, "gate", stdin);
  if (!stdout) return null;
  return parseGateVerdict(stdout, config);
}

export async function spawnPlanner(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string }
): Promise<{ kind: "next_prompt" | "file_done"; text: string } | null> {
  const fallback = `Run ID: ${run.id}
Worktree: ${run.worktree}
Memory ID: ${run.mem_id ?? "none"}

Review the current state and output your decision.`;
  const stdin = renderRolePrompt(config, "planner", fallback, {
    RUN_ID: String(run.id),
    WORKTREE: run.worktree,
    MEM_ID: run.mem_id ?? "none",
  });

  const stdout = await runSpawn(config, worktree, run.id, "planner", stdin);
  if (!stdout) return null;
  return parsePlanUpdate(stdout, config);
}

export async function spawnBigFixer(
  config: Config,
  worktree: string,
  runResult: { runId: number; facts: { files: number; lines: number; commits: string[]; branch: string }; parsed: { missing: boolean; checks?: string } }
): Promise<string | null> {
  const fallback = `Big diff detected: ${runResult.facts.files} files, ${runResult.facts.lines} lines.
Fix any issues found. Output HANDOFF when done.`;
  const stdin = renderRolePrompt(config, "bigFixer", fallback, {
    FILES: String(runResult.facts.files),
    LINES: String(runResult.facts.lines),
    BRANCH: runResult.facts.branch,
    HANDOFF: handoffMarker(config),
  });

  return runSpawn(config, worktree, runResult.runId, "bigFixer", stdin);
}

export async function spawnScrutinizeFix(
  config: Config,
  worktree: string,
  runResult: { runId: number; facts: { files: number; lines: number; commits: string[]; branch: string }; parsed: { missing: boolean; checks?: string } }
): Promise<string | null> {
  const db = openDb();
  const run = getRun(db, runResult.runId);
  const changedFiles = resolveChangedFiles(worktree, run?.base_sha);

  const stdin = buildScrutinizePrompt(worktree, runResult, changedFiles, config);

  return runSpawn(config, worktree, runResult.runId, "scrutinizeFix", stdin);
}
