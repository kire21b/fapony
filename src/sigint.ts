// src/sigint.ts — SIGINT handler for graceful shutdown.
//
// Usage: call installSigintHandler() before running any long operation.
// The handler will:
//   - 1st Ctrl-C: log "interrupted" event, mark run as stopped, release memory, exit 130
//   - 2nd Ctrl-C (during cleanup): force exit 130 immediately
//
// This is always active (not gated by resilience config) because clean interrupt
// is a baseline expectation, not a retry feature.

import { addEvent, getRun, loadConfig, openDb, setStatus } from "./db/index.js";
import { closeMemory } from "./memory.js";

let installed = false;
let forceExit = false;
let currentRunId: number | null = null;
let currentPhase: "spawn" | "backoff" = "spawn";

/**
 * Set the current run ID for SIGINT handling.
 * Call this before run/loop starts; the handler will use it to mark stopped + log event.
 */
export function setSigintRunId(runId: number | null): void {
  currentRunId = runId;
}

/**
 * Set the current phase so the SIGINT handler logs the correct `during` field.
 */
export function setSigintPhase(phase: "spawn" | "backoff"): void {
  currentPhase = phase;
}

/**
 * Check if SIGINT has been received (for isAborted polling in retry loops).
 */
export function isSigintReceived(): boolean {
  return forceExit;
}

/**
 * Install the SIGINT handler. Safe to call multiple times (only installs once).
 */
export function installSigintHandler(): void {
  if (installed) return;
  installed = true;

  process.on("SIGINT", () => {
    if (forceExit) {
      // Second Ctrl-C: force exit immediately
      process.exit(130);
    }
    forceExit = true;

    // First Ctrl-C: log event + mark stopped + release memory
    if (currentRunId !== null) {
      try {
        const db = openDb();
        const run = getRun(db, currentRunId);
        if (run && run.status !== "passed" && run.status !== "stopped") {
          addEvent(db, currentRunId, "interrupted", {
            during: currentPhase,
          });
          setStatus(db, currentRunId, "stopped");
          if (run.mem_id) {
            const config = loadConfig();
            closeMemory(
              config,
              config.worktrees[run.worktree] ?? ".",
              run.mem_id,
              "interrupted by SIGINT",
            );
          }
          console.error(`\nrun ${currentRunId} interrupted (SIGINT)`);
        }
      } catch {
        // best-effort; don't hang cleanup
      }
    }

    process.exit(130);
  });
}
