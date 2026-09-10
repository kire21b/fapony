// src/mcp/evidence.ts — allowlist-based evidence collector
//
// Runs only commands listed in `.fapony/evidence.json` inside the worktree,
// sequentially, each under assertSafe() + per-command timeout. Returns
// structured EvidenceItem[] without storing secret output.
//
// Agent-proposed commands are NEVER executed here — they are recorded as
// `unverified` claims (provenance: agent_report), matching the contract that
// `verified:false` means "fapony did not run this".
//
// §0 rule: fapony never writes to the worktree — this module only reads
// config and runs allowlisted commands (cwd = worktree).

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, safetyDeny } from "../db/index.js";
import { assertSafe } from "../safety.js";
import type { EvidenceItem, EvidenceStatus } from "./primitives.js";

// --- Config shape (.fapony/evidence.json) ---

interface EvidenceCommand {
  name: string;
  cmd: string;
  timeout_ms?: number;
}

interface EvidenceConfig {
  commands: EvidenceCommand[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 180_000;
const CONFIG_PATH = ".fapony/evidence.json";

const VERIFIED_PROVENANCE = { verified: true, source: "fapony_cli" } as const;
const AGENT_PROVENANCE = { verified: false, source: "agent_report" } as const;

// --- Allowlist reader ---

export function readEvidenceConfig(worktree: string): EvidenceConfig | null {
  const configPath = join(worktree, CONFIG_PATH);
  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as EvidenceConfig).commands)
    ) {
      return parsed as EvidenceConfig;
    }
    return null;
  } catch {
    return null;
  }
}

function isValidEntry(entry: unknown): entry is EvidenceCommand {
  return (
    !!entry &&
    typeof entry === "object" &&
    typeof (entry as EvidenceCommand).cmd === "string" &&
    (entry as EvidenceCommand).cmd.trim().length > 0
  );
}

function effectiveTimeout(entry: EvidenceCommand): number {
  const t = entry.timeout_ms;
  return typeof t === "number" && Number.isFinite(t) && t > 0
    ? t
    : DEFAULT_TIMEOUT_MS;
}

// --- Single command runner ---

interface CommandOutcome {
  exit_code: number | null;
  duration_ms: number;
  timedOut: boolean;
  errorNote?: string;
}

function runCommand(
  cmd: string,
  worktree: string,
  timeoutMs: number,
): CommandOutcome {
  const start = Date.now();
  try {
    execSync(cmd, {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    return {
      exit_code: 0,
      duration_ms: Date.now() - start,
      timedOut: false,
    };
  } catch (e: unknown) {
    const duration_ms = Date.now() - start;
    if (e && typeof e === "object") {
      const err = e as { signal?: unknown; killed?: unknown; status?: unknown };
      // Signal kill (incl. execSync timeout → SIGTERM) or missing status
      // means the process never exited normally — never message-sniffing:
      // Bun reports timeouts as "spawnSync /bin/sh ETIMEDOUT" with
      // status:null, which contains neither "timeout" nor "SIGTERM".
      if (err.signal != null || err.killed === true || err.status === null) {
        return { exit_code: null, duration_ms, timedOut: true };
      }
      if (typeof err.status === "number") {
        return { exit_code: err.status, duration_ms, timedOut: false };
      }
    }
    const msg =
      e && typeof e === "object" && "message" in e
        ? String((e as { message?: string }).message ?? "unknown")
        : "unknown";
    return {
      exit_code: -1,
      duration_ms,
      timedOut: false,
      errorNote: msg.slice(0, 200),
    };
  }
}

function statusFor(outcome: CommandOutcome): {
  status: EvidenceStatus;
  note?: string;
} {
  if (outcome.timedOut) return { status: "timeout" };
  if (outcome.exit_code === 0) return { status: "passed" };
  return { status: "failed", note: outcome.errorNote };
}

// --- Main collector ---

export interface CollectOptions {
  worktree: string;
  /** Agent-proposed commands — recorded as unverified, never executed. */
  agentCommands?: string[];
  /** Config for safetyDeny(); omit for built-in defaults. */
  config?: Config;
}

/**
 * Collect evidence from allowlisted commands + agent-proposed claims.
 *
 * Execution is sequential. Per-command timeout from config (default 30s),
 * clamped to the remaining share of the 60s total budget so one slow
 * command cannot blow past the cap. Remaining commands after the cap →
 * `timeout`. A command refused by assertSafe() → `failed` with the refusal
 * as note (surfaced, never silent, never crashing the report).
 */
export function collectEvidence(options: CollectOptions): EvidenceItem[] {
  const { worktree, agentCommands, config } = options;
  const items: EvidenceItem[] = [];

  const deny = safetyDeny(config);
  const evidenceConfig = readEvidenceConfig(worktree);
  const totalStart = Date.now();

  const totalTimeoutItem = (
    command: string,
    provenance: typeof VERIFIED_PROVENANCE | typeof AGENT_PROVENANCE,
  ): EvidenceItem => ({
    command,
    status: "timeout",
    exit_code: null,
    duration_ms: null,
    provenance: { ...provenance },
    note: `total report timeout exceeded ${TOTAL_TIMEOUT_MS}ms`,
  });

  const elapsed = () => Date.now() - totalStart;

  // Run allowlisted commands (verified provenance)
  if (evidenceConfig) {
    for (const entry of evidenceConfig.commands) {
      if (!isValidEntry(entry)) {
        items.push({
          command: String(
            (entry as { name?: unknown } | null)?.name ?? "(invalid entry)",
          ),
          status: "not_run",
          exit_code: null,
          duration_ms: null,
          provenance: { ...VERIFIED_PROVENANCE },
          note: "invalid entry in .fapony/evidence.json (cmd must be a non-empty string)",
        });
        continue;
      }

      if (elapsed() >= TOTAL_TIMEOUT_MS) {
        items.push(totalTimeoutItem(entry.cmd, VERIFIED_PROVENANCE));
        continue;
      }

      // Rule #4: every command through assertSafe before spawn — including
      // allowlisted ones (the file lives in agent-reachable worktree).
      try {
        assertSafe([entry.cmd], deny);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        items.push({
          command: entry.cmd,
          status: "failed",
          exit_code: null,
          duration_ms: null,
          provenance: { ...VERIFIED_PROVENANCE },
          note: msg.slice(0, 200),
        });
        continue;
      }

      // Clamp to remaining budget so a single slow command cannot exceed
      // the total cap (execSync blocks; the loop-top check alone is not a
      // hard cap for one long-timeout command).
      const timeoutMs = Math.min(
        effectiveTimeout(entry),
        Math.max(TOTAL_TIMEOUT_MS - elapsed(), 1),
      );
      const outcome = runCommand(entry.cmd, worktree, timeoutMs);
      const { status, note } = statusFor(outcome);

      items.push({
        command: entry.cmd,
        status,
        exit_code: outcome.exit_code,
        duration_ms: outcome.duration_ms,
        provenance: { ...VERIFIED_PROVENANCE },
        note:
          status === "timeout"
            ? `exceeded ${timeoutMs}ms`
            : (note ?? undefined),
      });
    }
  }

  // Agent-proposed commands: recorded as unverified claims, NEVER executed.
  // `verified:false` means "fapony did not run this" — executing here would
  // both lie in the provenance and hand arbitrary shell to the caller.
  if (agentCommands) {
    for (const cmd of agentCommands) {
      if (typeof cmd !== "string" || cmd.trim().length === 0) continue;
      // Already ran as allowlisted — avoid a duplicate item.
      if (evidenceConfig?.commands.some((e) => e.cmd === cmd)) continue;

      if (elapsed() >= TOTAL_TIMEOUT_MS) {
        items.push(totalTimeoutItem(cmd, AGENT_PROVENANCE));
        continue;
      }

      items.push({
        command: cmd,
        status: "unverified",
        exit_code: null,
        duration_ms: null,
        provenance: { ...AGENT_PROVENANCE },
        note: "proposed by agent — not in .fapony/evidence.json allowlist, not executed",
      });
    }
  }

  return items;
}
