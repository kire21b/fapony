// src/loop/scrutinize.ts — routing predicate + git diff + prompt builder for scrutinize-fix lane.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { promptFileFor, type Config } from "../db/index.js";

/**
 * Routing predicate for the scrutinize-fix lane — the small-diff mirror of
 * the `result.isBig && roles.bigFixer` branch above. Extracted (not inlined)
 * so tests assert the real branch condition, not a copy of it.
 */
export function shouldScrutinizeFix(
  result: { isBig: boolean; status: string },
  config: Config
): boolean {
  return !result.isBig && !!config.roles?.scrutinizeFix && result.status === "awaiting_review";
}

/**
 * Resolves the changed-file list for the prompt via base_sha..HEAD.
 * Falls back to sentinel strings when the base is unknown or the diff is empty.
 */
export function resolveChangedFiles(worktree: string, baseSha: string | null | undefined): string {
  if (!baseSha) return "(unknown — base sha unavailable)";
  try {
    return (
      execSync(`git diff --name-only ${baseSha}..HEAD -- .`, {
        cwd: worktree,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || "(none)"
    );
  } catch {
    return "(unknown — base sha unavailable)";
  }
}

/**
 * Builds the scrutinize-fix stdin: role prompt template + run context header.
 * The template alone carries no diff info, so the header supplies what the
 * role prompt requires (changed files + repo_root).
 */
export function buildScrutinizePrompt(
  worktree: string,
  runResult: { runId: number; facts: { files: number; lines: number; commits: string[]; branch: string } },
  changedFiles: string,
  config?: Config
): string {
  const promptPath =
    (config ? promptFileFor(config, "scrutinizeFix") : null) ??
    join(import.meta.dir, "..", "..", "prompts", "scrutinize-fix.md");
  const template = readFileSync(promptPath, "utf-8");
  return `${template}\n\n---\nRun ID: ${runResult.runId}\nrepo_root="${worktree}"\nChanged files (use these, do not auto-detect):\n${changedFiles}\nChanged: ${runResult.facts.files} files, ${runResult.facts.lines} lines, branch ${runResult.facts.branch}, commits ${runResult.facts.commits.join(", ") || "(none)"}\nReview the changed code then fix MAJOR/BLOCKER in place and commit.`;
}
