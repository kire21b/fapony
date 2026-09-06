// src/update.ts — self-update via git pull.
// Runs inside the fapony repo root (import.meta.dir).
// Shows old → new version, recent commits, and warns if uncommitted changes.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isAffirmative } from "./util.js";

const ROOT = import.meta.dir;

function git(args: string): string {
  return execSync(`git ${args}`, {
    encoding: "utf-8",
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
}

function gitQuiet(args: string): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function readVersion(): string {
  const pkgPath = join(ROOT, "package.json");
  if (!existsSync(pkgPath)) return "unknown";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Split `git status --porcelain` output into non-empty lines. Empty = clean. */
export function parseDirtyLines(porcelain: string): string[] {
  return porcelain.split("\n").filter((l) => l.trim() !== "");
}

/** The indented dirty-file block cmdUpdate prints before asking to proceed. */
export function formatDirtyBlock(porcelain: string): string {
  return parseDirtyLines(porcelain)
    .map((l) => `   ${l}`)
    .join("\n");
}

/** Only an affirmative answer proceeds past the dirty-tree warning. */
export function shouldProceedAfterDirty(answer: string): boolean {
  return isAffirmative(answer);
}

/** Same SHA before/after pull = already up to date. */
export function isUpToDate(oldSha: string, newSha: string): boolean {
  return oldSha === newSha;
}

function prompt(question: string, defaultVal?: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const suffix = defaultVal !== undefined ? ` (${defaultVal})` : "";
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

export async function cmdUpdate(): Promise<void> {
  console.log("\n🔄 fapony update\n");

  // --- sanity: must be a git repo ---
  const isRepo = gitQuiet("rev-parse --is-inside-work-tree");
  if (isRepo !== "true") {
    console.error(`❌ ${ROOT} is not a git repo — cannot self-update.`);
    console.error(
      "   Reinstall via: git clone https://github.com/kire21b/fapony.git",
    );
    process.exit(1);
  }

  // --- check uncommitted changes ---
  const dirty = git("status --porcelain");
  if (parseDirtyLines(dirty).length > 0) {
    console.log("⚠  You have uncommitted changes in the fapony repo:\n");
    console.log(formatDirtyBlock(dirty));
    console.log();
    const proceed = await prompt(
      "   Stash changes and pull anyway? (y/n)",
      "n",
    );
    if (!shouldProceedAfterDirty(proceed)) {
      console.log("\n  Update cancelled.");
      return;
    }
    git("stash push -m 'fapony auto-stash before update'");
    console.log("  ✓  Changes stashed.\n");
  }

  // --- capture old version + recent commits ---
  const oldVersion = readVersion();
  const oldSha = gitQuiet("rev-parse --short HEAD") ?? "unknown";

  // --- pull ---
  console.log("  Pulling latest changes...");
  const pullOutput = gitQuiet("pull --ff-only");
  if (pullOutput === null) {
    console.error("\n❌ git pull failed (non-fast-forward?).");
    console.error("   Resolve manually, then run: fapony update");
    if (dirty) {
      const popResult = gitQuiet("stash pop");
      if (popResult === null) {
        console.error(
          "\n⚠  Your changes are still stashed (auto-restore failed, conflict likely).",
        );
        console.error(
          "   Run `git stash pop` manually to get them back — do NOT `git stash drop`.",
        );
      } else {
        console.error("   ✓  Your stashed changes were restored.");
      }
    }
    process.exit(1);
  }

  // --- capture new version ---
  const newVersion = readVersion();
  const newSha = gitQuiet("rev-parse --short HEAD") ?? "unknown";

  // --- restore stashed changes ---
  if (dirty) {
    const popResult = gitQuiet("stash pop");
    if (popResult === null) {
      console.log(
        "\n  ⚠  Could not auto-restore your stashed changes — run `git stash pop` manually (conflict likely).",
      );
    } else {
      console.log("  ✓  Restored your stashed changes.");
    }
  }

  // --- show what changed ---
  if (isUpToDate(oldSha, newSha)) {
    console.log(`\n  ✓  Already up to date (${oldVersion} @ ${oldSha}).`);
    return;
  }

  console.log(
    `\n  ✓  Updated ${oldVersion}@${oldSha} → ${newVersion}@${newSha}`,
  );

  // --- recent commits since old SHA ---
  const logRange = gitQuiet(`log ${oldSha}..HEAD --oneline --no-decorate`);
  if (logRange) {
    console.log("\n  Recent changes:\n");
    for (const line of logRange.split("\n").slice(0, 10)) {
      console.log(`    ${line}`);
    }
  }

  // --- re-install dev deps if lockfile changed ---
  const lockChanged = gitQuiet("diff --name-only HEAD@{1} HEAD -- bun.lock");
  if (lockChanged) {
    console.log("\n  Lockfile changed — running bun install...");
    try {
      execSync("bun install", { cwd: ROOT, stdio: "pipe" });
      console.log("  ✓  Dependencies updated.");
    } catch {
      console.log("  ⚠  bun install failed — run manually: bun install");
    }
  }

  console.log(`
  ┌──────────────────────────────────────────┐
  │  Update complete!                        │
  │                                          │
  │  Version: ${newVersion.padEnd(31)}│
  │  Run "fapony test" to verify.            │
  └──────────────────────────────────────────┘
`);
}
