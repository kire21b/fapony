// src/init-mem.ts — scaffold the canonical .memory/ system into a new worktree.
// Source of truth lives in fapony/templates/memory/.
// Destination is <worktree>/.fapony/.memory/ (plans/specs/memory all live under
// .fapony/; run state stays in ~/.config/fapony/state.db, never in the worktree).
// Re-run to re-sync after editing the template — not automatic, on purpose.

import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./db.js";

export function copyDir(src: string, dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyDir(s, d));
    } else {
      copyFileSync(s, d);
      copied.push(d);
    }
  }
  return copied;
}

export function cmdInitMem(args: string[]): void {
  const worktreeKey = args[0];
  if (!worktreeKey) {
    console.error("usage: fapony init-mem <worktree-key>");
    process.exit(1);
  }

  const config = loadConfig();
  const worktree = config.worktrees[worktreeKey];
  if (!worktree) {
    console.error(`unknown worktree key: ${worktreeKey}`);
    console.error(`available: ${Object.keys(config.worktrees).join(", ")}`);
    process.exit(1);
  }

  const templateDir = join(import.meta.dir, "..", "templates", "memory");
  const destDir = join(worktree, ".fapony", ".memory");

  if (existsSync(join(destDir, "mem.ts"))) {
    console.error(
      `${destDir}/mem.ts already exists — re-running would overwrite local edits.\nDelete it first if you want a fresh copy from the template.`
    );
    process.exit(1);
  }

  const files = copyDir(templateDir, destDir);
  console.log(`scaffolded ${files.length} files into ${destDir}`);
  console.log(`\nAdd to fapony.config.json:`);
  console.log(
    `  "memory": {\n    "claim": ["bun", ".fapony/.memory/mem.ts", "claim", "{id}"],\n    "close": ["bun", ".fapony/.memory/mem.ts", "close", "{id}", "{msg}"],\n    "add":   ["bun", ".fapony/.memory/mem.ts", "add", "{kind}", "{text}"],\n    "kickoff": ["bun", ".fapony/.memory/mem.ts", "kickoff"]\n  }`
  );
}
