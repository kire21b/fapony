// test/helpers.ts — shared test helpers for fapony tests.
// Use these instead of re-implementing the pattern in every test file.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/db/index.js";
import { openDb } from "../src/db/index.js";
import { createTestRepo } from "./fixtures/repo.js";

/**
 * Run fn with an isolated temp db. The db is opened before fn and closed
 * after; FAPONY_STATE_DIR is set to a fresh temp dir and restored on return.
 * Temp dir is always cleaned up.
 */
export function withTmpDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    const db = openDb();
    const result = fn(db);
    db.close();
    return result;
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Async version of withTmpDb. FAPONY_STATE_DIR is set for the duration of fn
 * and restored on return. Temp dir is always cleaned up.
 */
export async function withTmpDbAsync<T>(fn: () => Promise<T>): Promise<T> {
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

/**
 * Minimal config for testing — no memory, no roles, default review.
 * Spread-add fields as needed: `{ ...baseConfig(), roles: { ... } }`.
 */
export function baseConfig(): Config {
  return {
    worktrees: { test: "/tmp/test" },
    executor: { cmd: ["opencode", "run"], timeoutMin: 45 },
    review: {
      bigDiff: { files: 15, lines: 400 },
      maxRounds: 2,
      gate: ["claude", "-p", "/code-review high"],
      prefilter: null,
    },
    memory: null,
  };
}

/**
 * Run fn with a temp git repo. The repo is cleaned up after fn returns.
 */
export function withTempRepo(fn: (dir: string) => void): void {
  const repo = createTestRepo();
  try {
    fn(repo.dir);
  } finally {
    repo.cleanup();
  }
}

/**
 * Run fn with console.error suppressed.
 */
export function silentErrors<T>(fn: () => T): T {
  const orig = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = orig;
  }
}
