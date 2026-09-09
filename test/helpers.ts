// test/helpers.ts — shared test helpers for fapony tests.
// Use these instead of re-implementing the pattern in every test file.

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/db/index.js";
import { openDb } from "../src/db/index.js";

/**
 * Creates a temp git repo with an initial commit, runs fn with its path,
 * and always cleans up. Used by MCP tests that need real git facts.
 */
export function withTempRepo(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-repo-"));
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git config user.email 'test@test.com'", {
      cwd: dir,
      stdio: "ignore",
    });
    execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "README.md"), "# test repo\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
    review: {
      maxRounds: 2,
    },
    memory: null,
  };
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
