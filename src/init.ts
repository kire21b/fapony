// src/init.ts — scaffold fapony project structure at a target path.
// Creates .fapony/plan/, .fapony/spec/, .fapony/.memory/ (from template).
// state.db stays in ~/.config/fapony/ by design (security boundary — see db.ts),
// never inside the worktree where agents have full write access.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyDir } from "./init-mem.js";

const FAPONY_README = `# .fapony/ — fapony project dir (plans, specs, memory)
# Plans live in .fapony/plan/, specs in .fapony/spec/, memory in .fapony/.memory/.
# state.db is NOT here by design — it lives in ~/.config/fapony/ where agents
# running in this worktree cannot rewrite run state / audit trail.
#
# Usage:
#   fapony init <path>         — scaffold (this directory is created here)
#   fapony kickoff <key>       — auto-detect pending plan and run
#   fapony run <key> --plan X  — explicit plan path
`;

export function initProject(targetPath: string): void {
  // Create target root
  mkdirSync(targetPath, { recursive: true });

  // --- .fapony/ marker ---
  const faponyDir = join(targetPath, ".fapony");
  if (existsSync(faponyDir)) {
    throw new Error(
      `${faponyDir} already exists — delete it first if you want a fresh scaffold.`
    );
  }
  mkdirSync(faponyDir, { recursive: true });
  writeFileSync(join(faponyDir, "README"), FAPONY_README);

  // --- plan/ spec/ .memory/ — all under .fapony/ ---
  const planDir = join(faponyDir, "plan");
  if (existsSync(planDir)) {
    throw new Error(`${planDir} already exists — not overwriting.`);
  }
  mkdirSync(planDir, { recursive: true });

  // --- spec/ ---
  const specDir = join(faponyDir, "spec");
  if (existsSync(specDir)) {
    throw new Error(`${specDir} already exists — not overwriting.`);
  }
  mkdirSync(specDir, { recursive: true });

  // --- .memory/ (from template) ---
  const memoryDir = join(faponyDir, ".memory");
  if (existsSync(join(memoryDir, "mem.ts"))) {
    throw new Error(
      `${memoryDir}/mem.ts already exists — delete it first if you want a fresh copy.`
    );
  }
  const templateDir = join(import.meta.dir, "..", "templates", "memory");
  const files = copyDir(templateDir, memoryDir);

  console.log(`scaffolded ${targetPath}/`);
  console.log(`  .fapony/         — project dir (plans, specs, memory)`);
  console.log(`  .fapony/plan/    — plan files`);
  console.log(`  .fapony/spec/    — spec files`);
  console.log(`  .fapony/.memory/ — ${files.length} files from template`);
  console.log(`\nNext: add "${targetPath}" to fapony.config.json worktrees`);
}

export function cmdInit(args: string[]): void {
  const targetPath = args[0];
  if (!targetPath) {
    console.error("usage: fapony init <path>");
    process.exit(1);
  }
  try {
    initProject(targetPath);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
