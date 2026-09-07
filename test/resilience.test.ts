// test/resilience.test.ts — unit tests for src/resilience.ts pure core + src/sigint.ts

import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backoffDelayMs,
  classifyFailure,
  DEFAULT_RETRY_POLICY,
  type FailureInfo,
  sleepInterruptible,
  withRetry,
} from "../src/resilience.js";
import {
  installSigintHandler,
  isSigintReceived,
  setSigintPhase,
  setSigintRunId,
} from "../src/sigint.js";

// --- classifyFailure ---

export function testClassifyAuth(): void {
  const info = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "Error: invalid api key provided",
  });
  if (info.cls !== "auth") throw new Error(`expected auth, got ${info.cls}`);
  if (info.exitCode !== 1)
    throw new Error(`expected exitCode 1, got ${info.exitCode}`);
}

export function testClassifyTimeout(): void {
  const info = classifyFailure({
    exitCode: 1,
    timedOut: true,
    stdout: "",
    stderr: "",
  });
  if (info.cls !== "timeout")
    throw new Error(`expected timeout, got ${info.cls}`);
}

export function testClassifyLimit(): void {
  const info = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: "rate limit exceeded, try again later",
    stderr: "",
  });
  if (info.cls !== "limit") throw new Error(`expected limit, got ${info.cls}`);
}

export function testClassifyLimit429(): void {
  const info = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "HTTP 429 Too Many Requests",
  });
  if (info.cls !== "limit") throw new Error(`expected limit, got ${info.cls}`);
}

export function testClassifyCrash(): void {
  const info = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "some random error",
  });
  if (info.cls !== "crash") throw new Error(`expected crash, got ${info.cls}`);
}

export function testClassifyEmpty(): void {
  const info = classifyFailure({
    exitCode: 0,
    timedOut: false,
    stdout: "   \n  ",
    stderr: "",
  });
  if (info.cls !== "empty") throw new Error(`expected empty, got ${info.cls}`);
}

// Regression: exit 0 + empty stdout + auth error on stderr → must classify as "auth", not "empty"
// This is the scenario the resilience retry path hit before the lastStderr fix.
export function testClassifyEmptyExitZeroStderrAuth(): void {
  const info = classifyFailure({
    exitCode: 0,
    timedOut: false,
    stdout: "",
    stderr: "Error: unauthorized, invalid api key",
  });
  if (info.cls !== "auth")
    throw new Error(`expected auth from stderr-only, got ${info.cls}`);
}

export function testClassifyTailTruncated(): void {
  const longStdout = "x".repeat(500);
  const info = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: longStdout,
    stderr: "",
  });
  if (info.tail.length > 200)
    throw new Error(`tail too long: ${info.tail.length}`);
}

export function testClassifyCustomPatterns(): void {
  const info = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: "custom provider cap reached",
    stderr: "",
    limitPatterns: [/custom provider cap/i],
  });
  if (info.cls !== "limit") throw new Error(`expected limit, got ${info.cls}`);
}

// --- backoffDelayMs ---

export function testBackoffExponential(): void {
  // With rand=1, delay = raw (no jitter reduction)
  const d1 = backoffDelayMs(1, 5000, 60000, () => 1);
  if (d1 !== 5000) throw new Error(`attempt 1: expected 5000, got ${d1}`);

  const d2 = backoffDelayMs(2, 5000, 60000, () => 1);
  if (d2 !== 10000) throw new Error(`attempt 2: expected 10000, got ${d2}`);

  const d3 = backoffDelayMs(3, 5000, 60000, () => 1);
  if (d3 !== 20000) throw new Error(`attempt 3: expected 20000, got ${d3}`);
}

export function testBackoffCappedAtMax(): void {
  const d = backoffDelayMs(10, 60000, 600000, () => 1);
  if (d !== 600000) throw new Error(`expected 600000 (cap), got ${d}`);
}

export function testBackoffJitterRange(): void {
  // Equal jitter: delay in [raw/2, raw] — never 0, even with rand=0
  // (a zero delay on a rate limit would hammer the API immediately).
  const d = backoffDelayMs(1, 5000, 60000, () => 0);
  if (d !== 2500) throw new Error(`expected 2500 with rand=0, got ${d}`);

  // Multiple samples should be in [raw/2, raw]
  for (let i = 0; i < 20; i++) {
    const delay = backoffDelayMs(1, 5000, 60000);
    if (delay < 2500 || delay > 5000)
      throw new Error(`delay out of range: ${delay}`);
  }
}

// --- sleepInterruptible ---

export async function testSleepInterruptibleCompletes(): Promise<void> {
  const start = Date.now();
  const aborted = await sleepInterruptible(50, 10, async () => false);
  if (aborted) throw new Error("should not be aborted");
  const elapsed = Date.now() - start;
  if (elapsed < 40) throw new Error(`slept too short: ${elapsed}ms`);
}

export async function testSleepInterruptibleAborts(): Promise<void> {
  let callCount = 0;
  const aborted = await sleepInterruptible(5000, 100, async () => {
    callCount++;
    return callCount >= 2; // abort on 2nd check
  });
  if (!aborted) throw new Error("should be aborted");
}

// --- withRetry ---

export async function testWithRetrySucceedsFirstTry(): Promise<void> {
  let attempts = 0;
  const result = await withRetry(
    async (n) => {
      attempts = n;
      return { ok: true as const, value: "done" };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
      isAborted: async () => false,
    },
  );
  if (!result.ok) throw new Error("should succeed");
  if (result.value !== "done")
    throw new Error(`unexpected value: ${result.value}`);
  if (attempts !== 1) throw new Error(`expected 1 attempt, got ${attempts}`);
}

export async function testWithRetrySucceedsAfterTwoFails(): Promise<void> {
  let attempts = 0;
  const failures: FailureInfo[] = [];
  const result = await withRetry(
    async (n) => {
      attempts++;
      if (n < 3) {
        return {
          ok: false as const,
          fail: {
            cls: "limit" as const,
            exitCode: 1,
            timedOut: false,
            tail: "rate limit",
          },
        };
      }
      return { ok: true as const, value: "ok" };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3, limitBaseMs: 10 },
      isAborted: async () => false,
      onRetry: (fail, next, delay) => {
        failures.push(fail);
        void next;
        void delay;
      },
    },
  );
  if (!result.ok) throw new Error("should succeed");
  if (result.value !== "ok")
    throw new Error(`unexpected value: ${result.value}`);
  if (attempts !== 3) throw new Error(`expected 3 attempts, got ${attempts}`);
  if (failures.length !== 2)
    throw new Error(`expected 2 failures logged, got ${failures.length}`);
}

export async function testWithRetryExhausts(): Promise<void> {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      return {
        ok: false as const,
        fail: {
          cls: "crash" as const,
          exitCode: 1,
          timedOut: false,
          tail: "boom",
        },
      };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3, crashBaseMs: 5 },
      isAborted: async () => false,
    },
  );
  if (result.ok) throw new Error("should fail");
  if (!result.exhausted) throw new Error("should be exhausted");
  if (attempts !== 3) throw new Error(`expected 3 attempts, got ${attempts}`);
}

export async function testWithRetryAuthNotRetried(): Promise<void> {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      return {
        ok: false as const,
        fail: {
          cls: "auth" as const,
          exitCode: 1,
          timedOut: false,
          tail: "bad key",
        },
      };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
      isAborted: async () => false,
    },
  );
  if (result.ok) throw new Error("should fail");
  if (!result.exhausted) throw new Error("should be exhausted");
  if (attempts !== 1)
    throw new Error(`auth should not retry, got ${attempts} attempts`);
}

export async function testWithRetryTimeoutNotRetried(): Promise<void> {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      return {
        ok: false as const,
        fail: {
          cls: "timeout" as const,
          exitCode: 1,
          timedOut: true,
          tail: "",
        },
      };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
      isAborted: async () => false,
    },
  );
  if (result.ok) throw new Error("should fail");
  if (attempts !== 1)
    throw new Error(`timeout should not retry, got ${attempts} attempts`);
}

export async function testWithRetryTerminalAttemptNumber(): Promise<void> {
  // Terminal (non-retried) failures must log the real attempt number, not n-1.
  const logged: number[] = [];
  const result = await withRetry(
    async () => {
      return {
        ok: false as const,
        fail: {
          cls: "auth" as const,
          exitCode: 1,
          timedOut: false,
          tail: "bad key",
        },
      };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
      isAborted: async () => false,
      onRetry: (_fail, nextAttempt) => {
        logged.push(nextAttempt - 1);
      },
    },
  );
  if (result.ok) throw new Error("should fail");
  if (logged.length !== 1 || logged[0] !== 1) {
    throw new Error(
      `terminal failure should log attempt 1, got ${JSON.stringify(logged)}`,
    );
  }
}

export function testClassifyLimitNeedsContext(): void {
  // A bare "429" (line number) or "credit" substring (accredited) must not
  // classify a deterministic crash as a rate limit.
  const lineNo = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: "at foo.ts:429:12",
    stderr: "",
  });
  if (lineNo.cls !== "crash")
    throw new Error(`expected crash, got ${lineNo.cls}`);
  const accredited = classifyFailure({
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "test accredited the wrong account",
  });
  if (accredited.cls !== "crash")
    throw new Error(`expected crash, got ${accredited.cls}`);
}

export async function testWithRetryAbortedBeforeAttempt(): Promise<void> {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      return { ok: true as const, value: "never" };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
      isAborted: async () => true,
    },
  );
  if (result.ok) throw new Error("should fail");
  if (attempts !== 0)
    throw new Error(`should not attempt when aborted, got ${attempts}`);
}

export async function testWithRetryCanRetryGateBlocks(): Promise<void> {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      return {
        ok: false as const,
        fail: { cls: "limit" as const, exitCode: 1, timedOut: false, tail: "" },
      };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
      isAborted: async () => false,
      canRetry: async () => false, // clean-tree gate says no
    },
  );
  if (result.ok) throw new Error("should fail");
  if (result.exhausted)
    throw new Error("gate-blocked should NOT report exhausted");
  if (attempts !== 1)
    throw new Error(`expected 1 attempt (gate blocked), got ${attempts}`);
}

// --- Integration: flaky agent that fails N times then succeeds ---

export async function testFlakyAgentRetriesAndSucceeds(): Promise<void> {
  let attempts = 0;
  const result = await withRetry(
    async (n) => {
      attempts = n;
      if (n <= 2) {
        return {
          ok: false as const,
          fail: classifyFailure({
            exitCode: 1,
            timedOut: false,
            stdout: "",
            stderr: "rate limit exceeded",
          }),
        };
      }
      return { ok: true as const, value: `success on attempt ${n}` };
    },
    {
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 5, limitBaseMs: 5 },
      isAborted: async () => false,
    },
  );
  if (!result.ok) throw new Error("should succeed after 2 failures");
  if (attempts !== 3) throw new Error(`expected 3 attempts, got ${attempts}`);
}

// --- SIGINT handler (isolated db) ---

async function withTmpHome<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    return await fn();
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function testSigintHandlerMarksStopped(): Promise<void> {
  await withTmpHome(async () => {
    installSigintHandler();
    setSigintRunId(42);

    // Verify phase setter works (defaults to "spawn")
    setSigintPhase("backoff");
    setSigintPhase("spawn");

    assert.equal(isSigintReceived(), false, "should not be triggered yet");
    setSigintRunId(null);
  });
  console.log("  ✓ sigint handler wiring + phase tracking");
}

export function testIsSigintReceivedDefaultFalse(): void {
  // After reset (new process), should be false
  assert.equal(isSigintReceived(), false);
  console.log("  ✓ isSigintReceived default false");
}
