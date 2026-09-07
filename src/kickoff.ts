// src/kickoff.ts — auto-detect pending plan and run.
// Scans <planDir>/, filters shipped plans, runs if exactly 1 pending.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { handoffMarker, loadConfig, planDir } from "./db/index.js";
import { renderHandoff } from "./handoff.js";
import { pendingPlans, worktreeFromCwd } from "./plans.js";
import { runOnce } from "./run/index.js";

export async function cmdKickoff(args: string[]): Promise<void> {
  const config = loadConfig();

  let worktreeKey: string | null = args[0] ?? null;
  if (!worktreeKey) {
    worktreeKey = worktreeFromCwd(config);
    if (!worktreeKey) {
      console.error(
        "usage: fapony kickoff <worktree-key>  — or cd into a configured worktree",
      );
      process.exit(1);
    }
    console.error(`kickoff: using worktree "${worktreeKey}" (from cwd)`);
  }

  const worktree = config.worktrees[worktreeKey];
  if (!worktree) {
    console.error(`unknown worktree key: ${worktreeKey}`);
    console.error(`available: ${Object.keys(config.worktrees).join(", ")}`);
    process.exit(1);
  }

  // Scan <planDir>/ for plan files that are NOT shipped
  const planDirRel = planDir(config);
  const planDirAbs = join(worktree, planDirRel);
  if (!existsSync(planDirAbs)) {
    console.error(
      `${planDirRel}/ not found in ${worktree} — run fapony init first?`,
    );
    process.exit(1);
  }
  const pending = pendingPlans(config, worktree);

  if (pending.length === 0) {
    console.error(`no pending plans found in ${planDirRel}/`);
    process.exit(1);
  }

  if (pending.length > 1) {
    console.error(`ambiguous: ${pending.length} pending plans found:`);
    for (const [i, name] of pending.entries()) {
      console.error(`  #${i + 1} ${planDirRel}/${name}`);
    }
    console.error(
      `\nPick one: fapony run <plan-prefix>  ·  or: fapony run ${worktreeKey} --plan ${planDirRel}/<name>`,
    );
    process.exit(1);
  }

  // Exactly 1 — run it
  const planPath = `${planDirRel}/${pending[0]}`;
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

  const handoff = renderHandoff(
    result.facts,
    result.parsed,
    handoffMarker(config),
  );
  console.log(`\n${handoff}`);

  console.log("\n--- next step (run manually) ---");
  const gate = config.review.gate.join(" ");
  console.log(
    `Route: ${result.isBig ? "big" : "small"} diff (${result.facts.files} files, ${result.facts.lines} lines)`,
  );
  console.log(`Run review: ${gate}`);
  console.log(`After review: fapony status`);
  if (result.parsed.not_done?.length) {
    console.log(`\n⚠ not_done items: ${result.parsed.not_done.join("; ")}`);
  }
}
