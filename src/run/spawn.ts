// src/run/spawn.ts — spawn executor agent

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beginSpawn, endSpawn } from "../cost.js";
import {
  getPendingFeedback,
  loadConfig,
  openDb,
  promptFileFor,
  safetyDeny,
} from "../db/index.js";
import { assertSafe } from "../safety.js";
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
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  /** stderr from the last attempt — used by classifyFailure when resilience retries. */
  lastStderr: string;
}

/**
 * Spawn the executor agent: resolve prompt, assert safety, run Bun.spawn,
 * drain stdout+stderr with timeout, return stdout + exitCode + timedOut.
 */
export async function spawnExecutor(input: SpawnInput): Promise<SpawnResult> {
  const {
    worktree,
    worktreeKey,
    planContent,
    specContent,
    memId,
    baseSha,
    runId,
  } = input;
  const config = loadConfig();

  const promptPath =
    promptFileFor(config, "executor") ??
    join(import.meta.dir, "..", "..", "prompts", "execute.md");
  const promptTemplate = readFileSync(promptPath, "utf-8");

  const db = openDb();
  const feedback = memId
    ? getPendingFeedback(db, worktreeKey, memId, runId)
    : null;
  if (feedback)
    console.error(`carrying forward review feedback from previous round`);

  const prompt = buildExecutorPrompt(
    promptTemplate,
    planContent,
    memId,
    specContent,
    feedback,
  );

  const executorCmdArr = executorCmd(config, memId);
  assertSafe(executorCmdArr, safetyDeny(config));

  const timeoutMs = config.executor.timeoutMin * 60 * 1000;

  const spawnEventId = beginSpawn(db, runId, config, "executor", prompt, {
    base_sha: baseSha,
  });

  let stdout = "";
  let stderr = "";
  let lastStderr = "";
  let exitCode = 0;
  let timedOut = false;

  try {
    const proc = Bun.spawn(executorCmdArr, {
      cwd: worktree,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    const drain = (
      readable: ReadableStream<Uint8Array>,
      write: (chunk: string) => void,
    ) => {
      const reader = readable.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      return (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          write(chunk);
        }
        return buffer;
      })();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const [outBuffer, errBuffer] = await Promise.all([
      drain(proc.stdout, (chunk) => process.stdout.write(chunk)),
      drain(proc.stderr, (chunk) => process.stderr.write(chunk)),
    ]);

    clearTimeout(timeout);
    stdout = outBuffer;
    stderr = errBuffer;
    lastStderr = errBuffer;
    exitCode = await proc.exited;
  } catch (e) {
    console.error(`executor failed: ${(e as Error).message}`);
    lastStderr = (e as Error).message;
    exitCode = 1;
  }

  endSpawn(db, spawnEventId, config, "executor", stdout);
  db.close();
  return { stdout, stderr, exitCode, timedOut, lastStderr };
}
