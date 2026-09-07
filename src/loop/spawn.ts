// src/loop/spawn.ts — generic agent spawn + role-specific wrappers for gate/planner/bigFixer/scrutinizeFix.

import { beginSpawn, endSpawn } from "../cost.js";
import {
  addEvent,
  type Config,
  getRun,
  handoffMarker,
  openDb,
  resilienceEnabled,
  resiliencePatterns,
  retryPolicy,
  roleTimeoutMin,
  safetyDeny,
} from "../db/index.js";
import { parseGateVerdict, parsePlanUpdate } from "../parse.js";
import {
  classifyFailure,
  withRetry,
  type FailureInfo,
} from "../resilience.js";
import { assertSafe } from "../safety.js";
import { templateArgs } from "../util.js";
import { renderRolePrompt } from "./prompt.js";
import { buildScrutinizePrompt, resolveChangedFiles } from "./scrutinize.js";

interface SpawnAttemptResult {
  stdout: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * Generic agent spawn — renders stdin, runs assertSafe (outside try so
 * dangerous commands throw loudly), spawns Bun, drains stdout+stderr with
 * timeout, and completes the cost-tracking event row.
 *
 * Returns stdout + exit info on success, or null on spawn failure/empty output.
 */
async function runSpawnRaw(
  config: Config,
  worktree: string,
  runId: number,
  role: string,
  stdin: string,
): Promise<{ ok: true; value: SpawnAttemptResult } | { ok: false; fail: FailureInfo }> {
  const roleConfig = config.roles?.[role]!;
  const cmd = templateArgs(roleConfig.cmd, {
    model: roleConfig.model ?? "",
    PROMPT: stdin,
  });
  assertSafe(cmd, safetyDeny(config));

  const timeoutMs = roleTimeoutMin(config, role) * 60 * 1000;
  const db = openDb();
  const spawnEventId = beginSpawn(db, runId, config, role, stdin);

  let stdout = "";
  let exitCode = 0;
  let timedOut = false;

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
    let buffer = "";

    const stderrDrain = new Response(proc.stderr).text();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    timer = timeout;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    if (timer) clearTimeout(timer);
    stdout = buffer;
    const errBuf = await stderrDrain;
    if (errBuf) process.stderr.write(errBuf);
    exitCode = await proc.exited;

    endSpawn(db, spawnEventId, config, role, stdout);

    if (exitCode === 0 && stdout.trim()) {
      return { ok: true, value: { stdout, exitCode, timedOut } };
    }

    // Failure — classify
    const patterns = resiliencePatterns(config);
    const fail = classifyFailure({
      exitCode,
      timedOut,
      stdout,
      stderr: errBuf,
      limitPatterns: patterns.limit,
      authPatterns: patterns.auth,
    });
    return { ok: false, fail };
  } catch (e) {
    console.error(`${role} spawn failed: ${(e as Error).message}`);
    endSpawn(db, spawnEventId, config, role, "");
    return {
      ok: false,
      fail: { cls: "crash", exitCode: 1, timedOut: false, tail: (e as Error).message },
    };
  }
}

/**
 * Run a role spawn with optional retry (when resilience is enabled).
 * Logs spawn_fail events for each failure.
 */
async function runSpawn(
  config: Config,
  worktree: string,
  runId: number,
  role: string,
  stdin: string,
  isAborted: () => Promise<boolean>,
): Promise<string | null> {
  const db = openDb();

  if (!resilienceEnabled(config)) {
    // Old behavior: no retry
    const result = await runSpawnRaw(config, worktree, runId, role, stdin);
    if (result.ok) return result.value.stdout || null;
    // Log spawn_fail for the single failure
    addSpawnFailEvent(db, runId, role, result.fail, 1);
    return null;
  }

  // With retry
  const policy = retryPolicy(config);
  const patterns = resiliencePatterns(config);

  const retryResult = await withRetry(
    async (_n) => {
      const r = await runSpawnRaw(config, worktree, runId, role, stdin);
      return r;
    },
    {
      policy: {
        maxAttempts: policy.maxAttempts,
        limitBaseMs: policy.limitBaseMs,
        crashBaseMs: policy.crashBaseMs,
        maxMs: policy.maxMs,
        retryable: ["limit", "crash", "empty"],
      },
      isAborted,
      onRetry: (fail, nextAttempt, delayMs) => {
        addSpawnFailEvent(db, runId, role, fail, nextAttempt - 1);
        if (delayMs > 0) {
          console.error(
            `${role} attempt ${nextAttempt - 1} failed (${fail.cls}) — retrying in ${(delayMs / 1000).toFixed(0)}s...`,
          );
        }
      },
    },
  );

  if (retryResult.ok) {
    return retryResult.value.stdout || null;
  }

  // Log final failure if not already logged by onRetry
  if (retryResult.exhausted) {
    addSpawnFailEvent(db, runId, role, retryResult.fail, policy.maxAttempts);
  }

  return null;
}

function addSpawnFailEvent(
  db: ReturnType<typeof openDb>,
  runId: number,
  role: string,
  fail: FailureInfo,
  attempt: number,
): void {
  addEvent(db, runId, "spawn_fail", {
    role,
    cls: fail.cls,
    exit_code: fail.exitCode,
    attempt,
    tail: fail.tail,
  });
}

// --- Role-specific wrappers (build stdin + call runSpawn) ---

export async function spawnGate(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string },
  isAborted?: () => Promise<boolean>,
): Promise<{ verdict: "pass" | "fail"; note: string } | null> {
  const stdin = renderRolePrompt(
    config,
    "gate",
    `Review run ${run.id} for worktree ${run.worktree}.`,
    {
      RUN_ID: String(run.id),
      WORKTREE: run.worktree,
      MEM_ID: run.mem_id ?? "none",
    },
  );

  const stdout = await runSpawn(
    config,
    worktree,
    run.id,
    "gate",
    stdin,
    isAborted ?? (async () => false),
  );
  if (!stdout) return null;
  return parseGateVerdict(stdout, config);
}

export async function spawnPlanner(
  config: Config,
  worktree: string,
  run: { id: number; mem_id: string | null; worktree: string },
  isAborted?: () => Promise<boolean>,
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

  const stdout = await runSpawn(
    config,
    worktree,
    run.id,
    "planner",
    stdin,
    isAborted ?? (async () => false),
  );
  if (!stdout) return null;
  return parsePlanUpdate(stdout, config);
}

export async function spawnBigFixer(
  config: Config,
  worktree: string,
  runResult: {
    runId: number;
    facts: { files: number; lines: number; commits: string[]; branch: string };
    parsed: { missing: boolean; checks?: string };
  },
  isAborted?: () => Promise<boolean>,
): Promise<string | null> {
  const fallback = `Big diff detected: ${runResult.facts.files} files, ${runResult.facts.lines} lines.
Fix any issues found. Output HANDOFF when done.`;
  const stdin = renderRolePrompt(config, "bigFixer", fallback, {
    FILES: String(runResult.facts.files),
    LINES: String(runResult.facts.lines),
    BRANCH: runResult.facts.branch,
    HANDOFF: handoffMarker(config),
  });

  return runSpawn(
    config,
    worktree,
    runResult.runId,
    "bigFixer",
    stdin,
    isAborted ?? (async () => false),
  );
}

export async function spawnScrutinizeFix(
  config: Config,
  worktree: string,
  runResult: {
    runId: number;
    facts: { files: number; lines: number; commits: string[]; branch: string };
    parsed: { missing: boolean; checks?: string };
  },
  isAborted?: () => Promise<boolean>,
): Promise<string | null> {
  const db = openDb();
  const run = getRun(db, runResult.runId);
  const changedFiles = resolveChangedFiles(worktree, run?.base_sha);

  const stdin = buildScrutinizePrompt(
    worktree,
    runResult,
    changedFiles,
    config,
  );

  return runSpawn(
    config,
    worktree,
    runResult.runId,
    "scrutinizeFix",
    stdin,
    isAborted ?? (async () => false),
  );
}
