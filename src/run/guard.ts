// src/run/guard.ts — git guard: reject dirty worktrees

import { execSync } from "node:child_process";
import { type Config, dirtyPreviewLines } from "../db/index.js";

export interface GuardResult {
  ok: boolean;
  error?: string;
}

/** Check git status --porcelain. Returns { ok: true } or { ok: false, error }. */
export function gitGuard(
  worktree: string,
  config: Config,
  allowDirty: boolean,
): GuardResult {
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();

    if (porcelain && !allowDirty) {
      const preview = dirtyPreviewLines(config);
      const all = porcelain.split("\n");
      const dirtyFiles = all.slice(0, preview).join("\n");
      const more =
        all.length > preview ? `\n  ... and ${all.length - preview} more` : "";
      return {
        ok: false,
        error: `worktree has uncommitted changes:\n${dirtyFiles}${more}\n\nRe-run with --allow-dirty to proceed.`,
      };
    }

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `git status failed in ${worktree}: ${(e as Error).message}`,
    };
  }
}
