// src/kickoff.ts — auto-detect pending plan and run.
// Scans .fapony/plan/*.md, filters shipped plans, runs if exactly 1 pending.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./db.js";
import { runOnce } from "./run.js";
import { renderHandoff } from "./handoff.js";
import { SHIPPED_RE } from "./planmv.js";

export async function cmdKickoff(args: string[]): Promise<void> {
  const worktreeKey = args[0];
  if (!worktreeKey) {
    console.error("usage: fapony kickoff <worktree-key>");
    process.exit(1);
  }

  const config = loadConfig();
  const worktree = config.worktrees[worktreeKey];
  if (!worktree) {
    console.error(`unknown worktree key: ${worktreeKey}`);
    console.error(`available: ${Object.keys(config.worktrees).join(", ")}`);
    process.exit(1);
  }

  // Scan .fapony/plan/ for .md files that are NOT shipped
  const planDir = join(worktree, ".fapony", "plan");
  let pending: string[] = [];
  try {
    const entries = readdirSync(planDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (entry.name === "done") continue; // skip .fapony/plan/done/ subdir
      const content = readFileSync(join(planDir, entry.name), "utf-8");
      if (!SHIPPED_RE.test(content)) {
        pending.push(entry.name);
      }
    }
  } catch {
    console.error(`.fapony/plan/ not found in ${worktree} — run fapony init first?`);
    process.exit(1);
  }

  if (pending.length === 0) {
    console.error("no pending plans found in .fapony/plan/");
    process.exit(1);
  }

  if (pending.length > 1) {
    console.error(`ambiguous: ${pending.length} pending plans found:`);
    for (const name of pending) {
      console.error(`  .fapony/plan/${name}`);
    }
    console.error("\nPick one and run: fapony run <key> --plan .fapony/plan/<name>");
    process.exit(1);
  }

  // Exactly 1 — run it
  const planPath = `.fapony/plan/${pending[0]}`;
  console.error(`kickoff: auto-detected ${planPath}`);

  const result = await runOnce({
    worktreeKey,
    planPath,
    planContent: null,
    memId: null,
    allowDirty: false,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  const handoff = renderHandoff(result.facts, result.parsed);
  console.log("\n" + handoff);

  console.log("\n--- next step (run manually) ---");
  const gate = config.review.gate.join(" ");
  console.log(
    `Route: ${result.isBig ? "big" : "small"} diff (${result.facts.files} files, ${result.facts.lines} lines)`
  );
  console.log(`Run review: ${gate}`);
  console.log(`After review: fapony status`);
  if (result.parsed.not_done?.length) {
    console.log(`\n⚠ not_done items: ${result.parsed.not_done.join("; ")}`);
  }
}
