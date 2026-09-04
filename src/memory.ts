// src/memory.ts — shell adapter helpers for config.memory.*
// ponytail: dedupe close-command logic that was copy-pasted in run.ts + stop.ts

import { execSync } from "node:child_process";
import type { Config } from "./db.js";
import { assertSafe } from "./safety.js";

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
  if (!config.memory) return;
  try {
    const cmd = templateArgs(config.memory.close, { id: memId, msg });
    assertSafe(cmd);
    execSync(cmd.join(" "), { cwd: worktree, stdio: "ignore" });
  } catch {
    // non-fatal, same as existing call sites
  }
}

/** Runs config.memory.kickoff (if configured) and returns its stdout, or null if unset/failed. */
export function kickoffMemory(config: Config, worktree: string): string | null {
  if (!config.memory?.kickoff) return null;
  try {
    assertSafe(config.memory.kickoff);
    return execSync(config.memory.kickoff.join(" "), {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
