// src/init.ts — scaffold fapony project structure at a target path.
// Creates .fapony/plan/, .fapony/spec/, .fapony/.memory/ (from template).
// state.db stays in ~/.config/fapony/ by design (security boundary — see db.ts),
// never inside the worktree where agents have full write access.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { copyDir } from "./init-mem.js";
import { planDir, specDir, memoryEntry, type Config } from "./db.js";

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

export function initProject(targetPath: string, config?: Config): void {
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
  const planDirAbs = join(targetPath, planDir(config));
  if (existsSync(planDirAbs)) {
    throw new Error(`${planDirAbs} already exists — not overwriting.`);
  }
  mkdirSync(planDirAbs, { recursive: true });

  // --- spec/ ---
  const specDirAbs = join(targetPath, specDir(config));
  if (existsSync(specDirAbs)) {
    throw new Error(`${specDirAbs} already exists — not overwriting.`);
  }
  mkdirSync(specDirAbs, { recursive: true });

  // --- .memory/ (from template) ---
  const memEntry = memoryEntry(config); // e.g. .fapony/.memory/mem.ts
  const memoryDir = join(targetPath, memEntry.split("/").slice(0, -1).join("/"));
  if (existsSync(join(targetPath, memEntry))) {
    throw new Error(
      `${join(targetPath, memEntry)} already exists — delete it first if you want a fresh copy.`
    );
  }
  const templateDir = join(import.meta.dir, "..", "templates", "memory");
  const files = copyDir(templateDir, memoryDir);

  console.log(`scaffolded ${targetPath}/`);
  console.log(`  .fapony/         — project dir (plans, specs, memory)`);
  console.log(`  ${planDir(config)}/    — plan files`);
  console.log(`  ${specDir(config)}/    — spec files`);
  console.log(`  ${relative(targetPath, memoryDir)}/ — ${files.length} files from template`);
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
