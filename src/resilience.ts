// src/resilience.ts — pure core: classify failure, exponential backoff + full jitter,
// interruptible retry wrapper. No process/db touches here — consumers wire those in.

export type FailureClass = "limit" | "auth" | "timeout" | "crash" | "empty";

export interface FailureInfo {
  cls: FailureClass;
  exitCode: number;
  timedOut: boolean;
  tail: string;
}

export interface ClassifyInput {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  limitPatterns?: RegExp[];
  authPatterns?: RegExp[];
}

const DEFAULT_LIMIT_PATTERNS = [
  /rate\s*limit/i,
  /429.{0,30}(too many|rate|limit|quota)|too many.{0,30}429/i,
  /usage limit/i,
  /credit.{0,30}(exceed|limit|quota|exhaust|insufficient)|insufficient.{0,30}credit/i,
  /quota/i,
  /overloaded/i,
];

const DEFAULT_AUTH_PATTERNS = [
  /unauthorized/i,
  /invalid api key/i,
  /authentication/i,
];

function tailOf(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(s.length - n);
}

/**
 * Classify a failure from exit code, timeout flag, and output.
 * Definitive order: auth → timeout → limit → crash/empty.
 */
export function classifyFailure(input: ClassifyInput): FailureInfo {
  const { exitCode, timedOut, stdout, stderr } = input;
  const limitPatterns = input.limitPatterns ?? DEFAULT_LIMIT_PATTERNS;
  const authPatterns = input.authPatterns ?? DEFAULT_AUTH_PATTERNS;
  const combined = `${stdout}\n${stderr}`;
  const tail = tailOf(combined, 200);

  // 1. auth — key wrong/expired, retry won't help
  for (const re of authPatterns) {
    if (re.test(combined)) {
      return { cls: "auth", exitCode, timedOut, tail };
    }
  }

  // 2. timeout — timedOut flag from spawn
  if (timedOut) {
    return { cls: "timeout", exitCode, timedOut, tail };
  }

  // 3. limit — pattern match on output
  for (const re of limitPatterns) {
    if (re.test(combined)) {
      return { cls: "limit", exitCode, timedOut, tail };
    }
  }

  // 4. exit code non-zero → crash
  if (exitCode !== 0) {
    return { cls: "crash", exitCode, timedOut, tail };
  }

  // 5. exit 0 but empty output → empty
  if (!stdout.trim()) {
    return { cls: "empty", exitCode, timedOut, tail };
  }

  // Shouldn't reach here if caller only calls classify on failures,
  // but default to crash for safety.
  return { cls: "crash", exitCode, timedOut, tail };
}

export interface RetryPolicy {
  maxAttempts: number;
  limitBaseMs: number;
  crashBaseMs: number;
  maxMs: number;
  retryable: FailureClass[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  limitBaseMs: 60_000,
  crashBaseMs: 5_000,
  maxMs: 600_000,
  retryable: ["limit", "crash", "empty"],
};

/**
 * Compute backoff delay with exponential + equal jitter.
 * raw = min(maxMs, baseMs × 2^(attempt-1)), then
 * delay = raw/2 + rand() × raw/2 — so the floor is raw/2, never 0.
 * A zero delay on a rate limit would hammer the API immediately.
 * rand injectable for deterministic tests.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  rand: () => number = Math.random,
): number {
  const raw = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  return Math.floor(raw / 2 + (rand() * raw) / 2);
}

/** Pick the right baseMs for a failure class. */
export function baseMsForCls(cls: FailureClass, policy: RetryPolicy): number {
  return cls === "limit" ? policy.limitBaseMs : policy.crashBaseMs;
}

/** Sleep in short chunks, checking abort flag between each. Returns true if aborted. */
export async function sleepInterruptible(
  ms: number,
  chunkMs: number,
  isAborted: () => Promise<boolean>,
): Promise<boolean> {
  let elapsed = 0;
  while (elapsed < ms) {
    if (await isAborted()) return true;
    const sleepFor = Math.min(chunkMs, ms - elapsed);
    await new Promise((r) => setTimeout(r, sleepFor));
    elapsed += sleepFor;
  }
  return await isAborted();
}

export interface WithRetryOpts<T> {
  policy: RetryPolicy;
  isAborted: () => Promise<boolean>;
  canRetry?: () => Promise<boolean>;
  onRetry?: (fail: FailureInfo, nextAttempt: number, delayMs: number) => void;
  onBeforeAttempt?: (attempt: number) => void;
}

export type WithRetryResult<T> =
  | { ok: true; value: T }
  | { ok: false; fail: FailureInfo; exhausted: boolean };

/**
 * Interruptible retry wrapper.
 * attempt(n) is called for each attempt (1-based).
 * isAborted is checked before every attempt and during backoff sleep.
 * canRetry (optional) gates whether retry is allowed at all (e.g. clean-tree gate).
 */
export async function withRetry<T>(
  attempt: (n: number) => Promise<{ ok: true; value: T } | { ok: false; fail: FailureInfo }>,
  opts: WithRetryOpts<T>,
): Promise<WithRetryResult<T>> {
  const { policy, isAborted, canRetry, onRetry, onBeforeAttempt } = opts;

  for (let n = 1; n <= policy.maxAttempts; n++) {
    // Check abort before each attempt
    if (await isAborted()) {
      return { ok: false, fail: { cls: "crash", exitCode: 1, timedOut: false, tail: "aborted" }, exhausted: false };
    }

    // Notify caller before attempt (e.g. set SIGINT phase to "spawn")
    onBeforeAttempt?.(n);

    // canRetry gate only applies to retries (n > 1), not the first attempt
    if (n > 1 && canRetry && !(await canRetry())) {
      return { ok: false, fail: { cls: "crash", exitCode: 1, timedOut: false, tail: "canRetry=false" }, exhausted: false };
    }

    const result = await attempt(n);
    if (result.ok) {
      return { ok: true, value: result.value };
    }

    const fail = result.fail;

    // Log spawn_fail event via onRetry (consumer wires event logging)
    // Don't retry if: last attempt, not retryable class, or auth/timeout
    const isLastAttempt = n >= policy.maxAttempts;
    const isRetryable = policy.retryable.includes(fail.cls);

    if (isLastAttempt || !isRetryable) {
      // Terminal call uses n+1 (same as the retry path) so consumers that
      // derive attempt = nextAttempt - 1 log the real attempt number.
      onRetry?.(fail, n + 1, 0);
      return { ok: false, fail, exhausted: true };
    }

    // Compute backoff and sleep
    const baseMs = baseMsForCls(fail.cls, policy);
    const delayMs = backoffDelayMs(n, baseMs, policy.maxMs);
    onRetry?.(fail, n + 1, delayMs);

    const aborted = await sleepInterruptible(delayMs, 1000, isAborted);
    if (aborted) {
      return { ok: false, fail, exhausted: false };
    }
  }

  // Shouldn't reach, but safety
  return { ok: false, fail: { cls: "crash", exitCode: 1, timedOut: false, tail: "exhausted" }, exhausted: true };
}
