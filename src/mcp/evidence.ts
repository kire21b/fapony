// src/mcp/evidence.ts — allowlist-based evidence collector
//
// Reads `.fapony/evidence.json` from the worktree and runs each command
// sequentially with per-command timeout.  Returns structured EvidenceItem[]
// without storing secret output.
//
// §0 rule: fapony never writes to the worktree — this module only reads
// config and runs commands (cwd = worktree).

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceItem } from "./primitives.js";

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
const TOTAL_TIMEOUT_MS = 60_000;
const CONFIG_PATH = ".fapony/evidence.json";

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

// --- Single command runner ---

function runCommand(
  cmd: string,
  worktree: string,
  timeoutMs: number,
): { exit_code: number; duration_ms: number; note?: string } {
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
    };
  } catch (e: unknown) {
    const duration_ms = Date.now() - start;
    if (
      e &&
      typeof e === "object" &&
      "status" in e &&
      typeof (e as { status: unknown }).status === "number"
    ) {
      return {
        exit_code: (e as { status: number }).status,
        duration_ms,
      };
    }
    // Timeout or other error
    const msg =
      e && typeof e === "object" && "message" in e
        ? String((e as { message?: string }).message ?? "unknown")
        : "unknown";
    const isTimeout = msg.includes("timeout") || msg.includes("SIGTERM");
    return {
      exit_code: -1,
      duration_ms,
      note: isTimeout ? `exceeded ${timeoutMs}ms` : msg.slice(0, 200),
    };
  }
}

// --- Main collector ---

export interface CollectOptions {
  worktree: string;
  /** Agent-proposed commands (not in allowlist → unverified). */
  agentCommands?: string[];
}

/**
 * Collect evidence by running allowlisted commands + agent-proposed commands.
 * Returns EvidenceItem[] with provenance set correctly.
 *
 * Execution is sequential.  Per-command timeout from config (default 30s).
 * Total timeout 60s hard cap — remaining commands → timeout.
 */
export function collectEvidence(options: CollectOptions): EvidenceItem[] {
  const { worktree, agentCommands } = options;
  const items: EvidenceItem[] = [];

  const config = readEvidenceConfig(worktree);
  const totalStart = Date.now();

  // Run allowlisted commands (verified provenance)
  if (config) {
    for (const entry of config.commands) {
      if (Date.now() - totalStart >= TOTAL_TIMEOUT_MS) {
        items.push({
          command: entry.cmd,
          status: "timeout",
          exit_code: null,
          duration_ms: null,
          provenance: { verified: true, source: "fapony_cli" },
          note: `total report timeout exceeded ${TOTAL_TIMEOUT_MS}ms`,
        });
        continue;
      }

      const timeoutMs = entry.timeout_ms ?? DEFAULT_TIMEOUT_MS;
      const result = runCommand(entry.cmd, worktree, timeoutMs);

      let status: EvidenceItem["status"];
      if (result.note?.startsWith("exceeded")) {
        status = "timeout";
      } else if (result.exit_code === 0) {
        status = "passed";
      } else {
        status = "failed";
      }

      items.push({
        command: entry.cmd,
        status,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        provenance: { verified: true, source: "fapony_cli" },
        note: result.note,
      });
    }
  }

  // Agent-proposed commands (unverified provenance)
  if (agentCommands) {
    for (const cmd of agentCommands) {
      // Skip if already in allowlist (already ran)
      if (config?.commands.some((e) => e.cmd === cmd)) continue;

      if (Date.now() - totalStart >= TOTAL_TIMEOUT_MS) {
        items.push({
          command: cmd,
          status: "timeout",
          exit_code: null,
          duration_ms: null,
          provenance: { verified: false, source: "agent_report" },
          note: `total report timeout exceeded ${TOTAL_TIMEOUT_MS}ms`,
        });
        continue;
      }

      const result = runCommand(cmd, worktree, DEFAULT_TIMEOUT_MS);

      let status: EvidenceItem["status"];
      if (result.note?.startsWith("exceeded")) {
        status = "timeout";
      } else if (result.exit_code === 0) {
        status = "passed";
      } else {
        status = "failed";
      }

      items.push({
        command: cmd,
        status,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        provenance: { verified: false, source: "agent_report" },
        note: result.note,
      });
    }
  }

  return items;
}
