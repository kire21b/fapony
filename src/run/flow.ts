// src/run/flow.ts — runOnce: the single-run orchestrator
//
// Steps (matching ARCHITECTURE.md §2):
//   1. GIT GUARD
//   2. BASE SHA + INSERT RUN
//   3. MEMORY CLAIM (optional)
//   4. RESOLVE PLAN CONTENT + HYGIENE + SPEC INJECTION
//   5. SPAWN EXECUTOR
//   6. GIT FACTS + PARSE HANDOFF
//   7. ROUTE

import { execSync } from "node:child_process";
import {
  addEvent,
  getActiveRuns,
  handoffMarker,
  loadConfig,
  newRun,
  openDb,
  setStatus,
  shortShaLen,
} from "../db/index.js";
import { gitFacts, parseHandoff } from "../handoff.js";
import { claimMemory, closeMemory } from "../memory.js";
import { gitGuard } from "./guard.js";
import { resolvePlan } from "./plan.js";
import { spawnExecutor } from "./spawn.js";
import type { RunOnceOpts, RunOnceResult } from "./types.js";

/**
 * Core run flow — does NOT call process.exit.
 * CLI wrapper (cmdRun) is responsible for exit codes.
 */
export async function runOnce(opts: RunOnceOpts): Promise<RunOnceResult> {
  const {
    worktreeKey,
    planPath,
    planContent: planContentOverride,
    memId,
    allowDirty,
  } = opts;
  const config = loadConfig();
  const worktree = config.worktrees[worktreeKey];

  if (!worktree) {
    return {
      runId: 0,
      status: "stopped",
      facts: { files: 0, lines: 0, commits: [], branch: "" },
      parsed: { missing: true },
      isBig: false,
      error: `unknown worktree key: ${worktreeKey} (available: ${Object.keys(config.worktrees).join(", ")})`,
    };
  }

  // --- 1. GIT GUARD ---
  const guard = gitGuard(worktree, config, allowDirty);
  if (!guard.ok) {
    return {
      runId: 0,
      status: "stopped",
      facts: { files: 0, lines: 0, commits: [], branch: "" },
      parsed: { missing: true },
      isBig: false,
      error: guard.error,
    };
  }

  const db = openDb();

  // --- 1b. CONCURRENCY GUARD: reject if another run is already active on this worktree ---
  const clash = getActiveRuns(db).find((r) => r.worktree === worktreeKey);
  if (clash) {
    return {
      runId: 0,
      status: "stopped",
      facts: { files: 0, lines: 0, commits: [], branch: "" },
      parsed: { missing: true },
      isBig: false,
      error: `worktree "${worktreeKey}" already has an active run (id ${clash.id}, status ${clash.status}) — two executors on the same tree will race. Run \`fapony stop ${clash.id}\` first if it's stale.`,
    };
  }

  // --- 2. BASE SHA + INSERT RUN ---
  const baseSha = execSync("git rev-parse HEAD", {
    cwd: worktree,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();

  const runId = newRun(db, worktreeKey, planPath, memId, baseSha);

  console.error(
    `run ${runId} started (base ${baseSha.slice(0, shortShaLen(config))})`,
  );

  // --- 3. MEMORY CLAIM (optional) ---
  if (memId) {
    try {
      const claimed = claimMemory(config, worktree, memId);
      if (claimed) {
        addEvent(db, runId, "memory_claim", { mem_id: memId });
        console.error(`memory claimed: ${memId}`);
      } else {
        console.error(
          `memory skipped (disabled or no .fapony/.memory/mem.ts): ${memId}`,
        );
      }
    } catch (e) {
      console.error(`memory claim failed (non-fatal): ${(e as Error).message}`);
      addEvent(db, runId, "memory_claim_failed", {
        mem_id: memId,
        error: (e as Error).message,
      });
    }
  }

  // --- 4. RESOLVE PLAN + SPEC ---
  const { planContent, specContent } = resolvePlan(
    worktree,
    planPath,
    planContentOverride,
    config,
  );

  // --- 5. SPAWN EXECUTOR ---
  const { stdout, exitCode } = await spawnExecutor({
    worktree,
    worktreeKey,
    planContent,
    specContent,
    memId,
    baseSha,
    runId,
  });

  // --- TIMEOUT / EXIT CHECK ---
  if (exitCode !== 0) {
    setStatus(db, runId, "stalled");
    addEvent(db, runId, "stalled", { exit_code: exitCode });
    console.error(`\nfapony: run ${runId} stalled (exit ${exitCode})`);

    if (memId) closeMemory(config, worktree, memId, `run ${runId} stalled`);

    return {
      runId,
      status: "stalled",
      facts: { files: 0, lines: 0, commits: [], branch: "" },
      parsed: { missing: true },
      isBig: false,
    };
  }

  // --- 6. GIT FACTS + PARSE HANDOFF ---
  const facts = gitFacts(worktree, baseSha);
  const parsed = parseHandoff(stdout, handoffMarker(config));

  addEvent(db, runId, "handoff", parsed);

  for (const hash of facts.commits) {
    addEvent(db, runId, "commit", { hash });
  }

  // --- 7. ROUTE ---
  const isBig =
    facts.files > config.review.bigDiff.files ||
    facts.lines > config.review.bigDiff.lines;

  addEvent(db, runId, "route", {
    big: isBig,
    files: facts.files,
    lines: facts.lines,
  });
  setStatus(db, runId, "awaiting_review");

  return { runId, status: "awaiting_review", facts, parsed, isBig };
}
