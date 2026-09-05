// src/init.ts — scaffold fapony project structure at a target path.
// Creates plan/, spec/, .memory/ (from template), and .fapony/ marker.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyDir } from "./init-mem.js";

const FAPONY_README = `# .fapony/ — local marker
# This directory marks the project root for fapony.
# Do not commit this directory — add .fapony/ to .gitignore.
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

  // --- plan/ ---
  const planDir = join(targetPath, "plan");
  if (existsSync(planDir)) {
    throw new Error(`${planDir} already exists — not overwriting.`);
  }
  mkdirSync(planDir, { recursive: true });

  // --- spec/ ---
  const specDir = join(targetPath, "spec");
  if (existsSync(specDir)) {
    throw new Error(`${specDir} already exists — not overwriting.`);
  }
  mkdirSync(specDir, { recursive: true });

  // --- .memory/ (from template) ---
  const memoryDir = join(targetPath, ".memory");
  if (existsSync(join(memoryDir, "mem.ts"))) {
    throw new Error(
      `${memoryDir}/mem.ts already exists — delete it first if you want a fresh copy.`
    );
  }
  const templateDir = join(import.meta.dir, "..", "templates", "memory");
  const files = copyDir(templateDir, memoryDir);

  console.log(`scaffolded ${targetPath}/`);
  console.log(`  .fapony/     — local marker`);
  console.log(`  plan/        — plan files`);
  console.log(`  spec/        — spec files`);
  console.log(`  .memory/     — ${files.length} files from template`);
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
