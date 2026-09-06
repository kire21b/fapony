// src/run/cli.ts — cmdRun: CLI wrapper for runOnce

import {
  loadConfig,
  openDb,
  getEvents,
  handoffMarker,
} from "../db/index.js";
import { renderHandoff } from "../handoff.js";
import { sumSpawnCost } from "../cost.js";
import { runOnce } from "./flow.js";

export async function cmdRun(args: string[]): Promise<void> {
  const worktreeKey = args[0];
  if (!worktreeKey) {
    console.error("usage: fapony run <worktree-key> --plan <path> [--mem-id <id>] [--allow-dirty]");
    process.exit(1);
  }

  let planPath: string | null = null;
  let memId: string | null = null;
  let allowDirty = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      planPath = args[++i];
    } else if (args[i] === "--mem-id" && args[i + 1]) {
      memId = args[++i];
    } else if (args[i] === "--allow-dirty") {
      allowDirty = true;
    }
  }

  const result = await runOnce({ worktreeKey, planPath, planContent: null, memId, allowDirty });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  const config = loadConfig();
  let cost = undefined;
  if (result.runId) {
    const costDb = openDb();
    cost = sumSpawnCost(getEvents(costDb, result.runId));
    costDb.close();
  }
  const handoff = renderHandoff(result.facts, result.parsed, handoffMarker(config), cost);
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
