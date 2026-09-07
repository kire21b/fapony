// src/run/cli.ts — cmdRun: CLI wrapper for runOnce + runLoop
//
// Full form:     fapony run <key> --plan <path> [--mem-id <id>] [--allow-dirty] [--loop]
// Short forms (cwd inside a configured worktree, plans listed by `fapony ps`):
//   fapony run                          → auto-pick when exactly 1 pending plan
//   fapony run <plan-prefix>            → e.g. fapony run PLAN-al
//   fapony run <key> <plan-prefix>      → same, with explicit worktree key
//   fapony run <run-id>                 → resume existing run (single round)
//   fapony run <run-id> --loop          → resume existing run (loop until done)
//
// A bare digit is always a run ID, never a plan index — the two namespaces
// used to collide (a digit would silently resolve as a plan index before
// ever being tried as a run ID).

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type RunCost, sumSpawnCost } from "../cost.js";
import {
  type Config,
  getEvents,
  getRun,
  handoffMarker,
  loadConfig,
  openDb,
  planDir,
} from "../db/index.js";
import { renderHandoff } from "../handoff.js";
import { runLoop } from "../loop/index.js";
import { pendingPlans, resolvePlanArg, worktreeFromCwd } from "../plans.js";
import { runOnce } from "./flow.js";

const USAGE =
  "usage: fapony run [<worktree-key>] [<plan-prefix>|<run-id>] --plan <path> [--mem-id <id>] [--allow-dirty] [--loop]";

type ParsedArgs = {
  positional: string[];
  planPath: string | null;
  memId: string | null;
  allowDirty: boolean;
  loop: boolean;
};

export function parseRunArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  let planPath: string | null = null;
  let memId: string | null = null;
  let allowDirty = false;
  let loop = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      planPath = args[++i];
    } else if (args[i] === "--mem-id" && args[i + 1]) {
      memId = args[++i];
    } else if (args[i] === "--allow-dirty") {
      allowDirty = true;
    } else if (args[i] === "--loop") {
      loop = true;
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, planPath, memId, allowDirty, loop };
}

export type RunCliResolution =
  | {
      ok: true;
      worktreeKey: string;
      planPath: string | null;
      memId: string | null;
      allowDirty: boolean;
      loop: boolean;
      runId?: number;
    }
  | { ok: false; error: string };

function planPathError(worktree: string, planPath: string): string {
  return `plan file not found: ${join(worktree, planPath)}`;
}

/** Pure resolution of run CLI args → (worktreeKey, planPath). cwd-injectable
 * for tests. --plan always wins; short forms resolve via pendingPlans(). */
export function resolveRunArgs(
  config: Config,
  args: string[],
  cwd?: string,
): RunCliResolution {
  const { positional, planPath, memId, allowDirty, loop } = parseRunArgs(args);

  let key: string;
  let planRef: string | null = null;

  const first = positional[0];
  if (first && config.worktrees[first]) {
    key = first;
    planRef = positional[1] ?? null;
  } else if (first) {
    const inferred = worktreeFromCwd(config, cwd);
    if (!inferred) {
      return {
        ok: false,
        error: `unknown worktree key: ${first} (available: ${Object.keys(config.worktrees).join(", ")}) — or cd into a configured worktree`,
      };
    }
    key = inferred;
    planRef = first;
  } else {
    const inferred = worktreeFromCwd(config, cwd);
    if (!inferred) {
      return {
        ok: false,
        error: `${USAGE}\n(no worktree key given and cwd is not a configured worktree)`,
      };
    }
    key = inferred;
  }

  const worktree = config.worktrees[key];

  if (planPath) {
    if (isAbsolute(planPath) || !existsSync(join(worktree, planPath))) {
      return { ok: false, error: planPathError(worktree, planPath) };
    }
    return { ok: true, worktreeKey: key, planPath, memId, allowDirty, loop };
  }

  if (planRef) {
    // A bare digit is always a run ID, never a plan index — no more
    // guessing between the two namespaces.
    if (/^\d+$/.test(planRef)) {
      const runId = Number.parseInt(planRef, 10);
      const db = openDb(config);
      const run = getRun(db, runId);
      db.close();
      if (!run) {
        return { ok: false, error: `run ${runId} not found` };
      }
      if (run.status === "awaiting_review" || run.status === "fixing") {
        return {
          ok: true,
          worktreeKey: key,
          planPath: run.plan,
          memId: run.mem_id,
          allowDirty,
          loop,
          runId,
        };
      }
      return { ok: false, error: `#${runId} is a run ID (${run.status})` };
    }

    if (planRef.includes("/") || isAbsolute(planRef)) {
      return {
        ok: false,
        error: `plan ref must be a filename prefix — for a path use: fapony run ${key} --plan ${planRef}`,
      };
    }
    const res = resolvePlanArg(config, key, planRef);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    return {
      ok: true,
      worktreeKey: key,
      planPath: res.planPath,
      memId,
      allowDirty,
      loop,
    };
  }

  const pending = pendingPlans(config, worktree);
  if (pending.length === 0) {
    return {
      ok: false,
      error: `no pending plans in ${planDir(config)}/ — pass --plan <path>`,
    };
  }
  if (pending.length > 1) {
    return {
      ok: false,
      error: [
        `ambiguous: ${pending.length} pending plans in ${key}:`,
        ...pending.map((n, i) => `  #${i + 1} ${n}`),
        `pick one: fapony run <plan-prefix>  ·  or: fapony run ${key} --plan ${planDir(config)}/<name>`,
      ].join("\n"),
    };
  }
  return {
    ok: true,
    worktreeKey: key,
    planPath: `${planDir(config)}/${pending[0]}`,
    memId,
    allowDirty,
    loop,
  };
}

export async function cmdRun(args: string[]): Promise<void> {
  const config = loadConfig();
  const resolved = resolveRunArgs(config, args);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exit(1);
  }

  // --- Resume mode: run ID provided ---
  if (resolved.runId) {
    const db = openDb();
    const run = getRun(db, resolved.runId);
    db.close();

    if (!run) {
      console.error(`run ${resolved.runId} not found`);
      process.exit(1);
    }

    // Already done — show status
    if (
      run.status === "passed" ||
      run.status === "stopped" ||
      run.status === "stalled"
    ) {
      console.error(`run ${resolved.runId} is already ${run.status}`);
      process.exit(0);
    }

    // Awaiting review — show handoff and suggest gate
    if (run.status === "awaiting_review") {
      const costDb = openDb();
      const cost = sumSpawnCost(getEvents(costDb, resolved.runId));
      costDb.close();

      const handoff = renderHandoff(
        { files: 0, lines: 0, commits: [], branch: "" },
        { missing: true },
        handoffMarker(config),
        cost,
      );
      console.log(`\n${handoff}`);
      console.log(`\nrun ${resolved.runId} awaiting review`);
      console.log(`Review: fapony gate ${resolved.runId} pass|fail [note]`);
      if (resolved.loop) {
        console.log(`Resume loop: fapony run ${resolved.runId} --loop`);
      }
      return;
    }

    // Running — can't resume
    if (run.status === "running") {
      console.error(`run ${resolved.runId} is already running`);
      process.exit(1);
    }

    // Fixing — resume with loop or single round
    if (resolved.loop) {
      await runLoop({
        worktreeKey: run.worktree,
        planPath: run.plan,
        memId: run.mem_id,
        allowDirty: true,
        runId: resolved.runId,
      });
      return;
    }

    // Single round resume for fixing status — fall through to runOnce below
    // (will create a new run with the same plan + feedback)
  }

  // --- Normal mode: new run ---
  const result = await runOnce({
    worktreeKey: resolved.worktreeKey,
    planPath: resolved.planPath,
    planContent: null,
    memId: resolved.memId,
    allowDirty: resolved.allowDirty,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  // If --loop flag, continue with loop driver
  if (resolved.loop) {
    await runLoop({
      worktreeKey: resolved.worktreeKey,
      planPath: resolved.planPath,
      memId: resolved.memId,
      allowDirty: resolved.allowDirty,
      runId: result.runId,
    });
    return;
  }

  // Single run — show handoff and exit
  let cost: RunCost | undefined;
  if (result.runId) {
    const costDb = openDb();
    cost = sumSpawnCost(getEvents(costDb, result.runId));
    costDb.close();
  }
  const handoff = renderHandoff(
    result.facts,
    result.parsed,
    handoffMarker(config),
    cost,
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
