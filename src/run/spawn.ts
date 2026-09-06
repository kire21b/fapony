// src/run/spawn.ts — spawn executor agent

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  openDb,
  loadConfig,
  getPendingFeedback,
  specMaxLines,
  handoffMarker,
  safetyDeny,
  promptFileFor,
  type Config,
} from "../db/index.js";
import { assertSafe } from "../safety.js";
import { beginSpawn, endSpawn } from "../cost.js";
import { buildExecutorPrompt, executorCmd } from "./prompt.js";

export interface SpawnInput {
  worktree: string;
  worktreeKey: string;
  planContent: string;
  specContent: string | null;
  memId: string | null;
  baseSha: string;
  runId: number;
}

export interface SpawnResult {
  stdout: string;
  exitCode: number;
}

/**
 * Spawn the executor agent: resolve prompt, assert safety, run Bun.spawn,
 * drain stdout+stderr with timeout, return stdout + exitCode.
 */
export async function spawnExecutor(input: SpawnInput): Promise<SpawnResult> {
  const { worktree, worktreeKey, planContent, specContent, memId, baseSha, runId } = input;
  const config = loadConfig();

  const promptPath =
    promptFileFor(config, "executor") ??
    join(import.meta.dir, "..", "..", "prompts", "execute.md");
  const promptTemplate = readFileSync(promptPath, "utf-8");

  const db = openDb();
  const feedback = memId ? getPendingFeedback(db, worktreeKey, memId, runId) : null;
  if (feedback) console.error(`carrying forward review feedback from previous round`);

  const prompt = buildExecutorPrompt(promptTemplate, planContent, memId, specContent, feedback);

  const executorCmdArr = executorCmd(config, memId);
  assertSafe(executorCmdArr, safetyDeny(config));

  const timeoutMs = config.executor.timeoutMin * 60 * 1000;

  const spawnEventId = beginSpawn(db, runId, config, "executor", prompt, {
    base_sha: baseSha,
  });

  let stdout = "";
  let exitCode = 0;

  try {
    const proc = Bun.spawn(executorCmdArr, {
      cwd: worktree,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const stderrDrain = new Response(proc.stderr).text();

    const timeout = setTimeout(() => {
      proc.kill();
    }, timeoutMs);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      process.stdout.write(chunk);
    }

    clearTimeout(timeout);
    stdout = buffer;
    const errText = await stderrDrain;
    if (errText) process.stderr.write(errText);
    exitCode = await proc.exited;
  } catch (e) {
    console.error(`executor failed: ${(e as Error).message}`);
    exitCode = 1;
  }

  endSpawn(db, spawnEventId, config, "executor", stdout);
  return { stdout, exitCode };
}
