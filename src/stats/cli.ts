// src/stats/cli.ts — cmdStats CLI entry point

import { execFileSync } from "node:child_process";
import { getStatsData } from "./data.js";
import { formatStatsText } from "./format.js";

/** Absolute path of the repo/worktree the CLI was run in, or null outside git. */
function currentWorktree(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function cmdStats(args: string[]): void {
  // Default to the project you are standing in. Averaging several projects
  // together reads as "in this project" while being no such thing, so going
  // global is opt-in and the header always says which one you got.
  const worktree = args.includes("--all")
    ? undefined
    : (currentWorktree() ?? undefined);
  console.log(formatStatsText(getStatsData(worktree)));
}
