// src/memory.ts — shell adapter helpers for config.memory.*
// ponytail: dedupe close-command logic that was copy-pasted in run.ts + stop.ts

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { Config } from "./db.js";
import { assertSafe } from "./safety.js";

/** Default memory commands — matches templates/memory/mem.ts CLI. */
export const DEFAULT_MEMORY: Config["memory"] = {
  claim: ["bun", ".memory/mem.ts", "claim", "{id}"],
  close: ["bun", ".memory/mem.ts", "close", "{id}", "{msg}"],
  add: ["bun", ".memory/mem.ts", "add", "{kind}", "{text}"],
  kickoff: ["bun", ".memory/mem.ts", "kickoff"],
};

/**
 * Returns the effective memory config:
 * - explicit config.memory wins if set
 * - fallback: config.memory === null + .memory/mem.ts exists → DEFAULT_MEMORY
 * - otherwise null (no memory)
 */
export function resolveMemoryConfig(
  config: Config,
  worktree: string
): Config["memory"] {
  if (config.memory) return config.memory;
  if (existsSync(join(worktree, ".memory", "mem.ts"))) return DEFAULT_MEMORY;
  return null;
}

function templateArgs(arr: string[], vars: Record<string, string>): string[] {
  return arr.map((s) => {
    let out = s;
    for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, v);
    return out;
  });
}

export function closeMemory(
  config: Config,
  worktree: string,
  memId: string,
  msg: string
): void {
  const mem = resolveMemoryConfig(config, worktree);
  if (!mem) return;
  try {
    const cmd = templateArgs(mem.close, { id: memId, msg });
    assertSafe(cmd);
    execSync(cmd.join(" "), { cwd: worktree, stdio: "ignore" });
  } catch {
    // non-fatal, same as existing call sites
  }
}

export function claimMemory(
  config: Config,
  worktree: string,
  memId: string
): void {
  const mem = resolveMemoryConfig(config, worktree);
  if (!mem) return;
  const cmd = templateArgs(mem.claim, { id: memId });
  assertSafe(cmd);
  execSync(cmd.join(" "), {
    cwd: worktree,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** Runs memory.kickoff (if configured or default-wired) and returns its stdout, or null if unset/failed. */
export function kickoffMemory(
  config: Config,
  worktree: string
): string | null {
  const mem = resolveMemoryConfig(config, worktree);
  if (!mem?.kickoff) return null;
  try {
    assertSafe(mem.kickoff);
    return execSync(mem.kickoff.join(" "), {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
