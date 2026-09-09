// src/session/claude-code.ts — Claude Code passive usage reader
//
// Reads ~/.claude/projects/<encoded-cwd>/*.jsonl (one file per session).
// Each line is a JSON object; usage data lives in message.usage on
// assistant-response lines. No cost field — total_cost is always 0.
//
// No detail (tool/step breakdown) in v1 — JSONL has no part-table equivalent.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_RESULT,
  type ModelBreakdown,
  type PassiveUsageResult,
} from "./types.js";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

function resolveProjectsDir(optDir?: string): string {
  return optDir ?? process.env.FAPONY_CLAUDE_PROJECTS_DIR ?? PROJECTS_DIR;
}

/** Encode a file path the same way Claude Code does: `/` → `-`. */
function encodePath(p: string): string {
  return p.replace(/\//g, "-");
}

interface UsageLine {
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens_details?: {
        thinking_tokens?: number;
      };
    };
  };
  timestamp?: string;
}

interface ModelAcc {
  session_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost: number;
}

/**
 * Read passive usage from Claude Code JSONL session files.
 * Returns EMPTY_RESULT when the projects dir or matching project subdir doesn't exist.
 */
export function readClaudeCodeUsage(
  worktree?: string,
  since?: number,
  until?: number,
): PassiveUsageResult {
  const projectsDir = resolveProjectsDir();

  // Determine which project dirs to scan.
  let projectDirs: string[];
  if (worktree) {
    const encoded = encodePath(worktree);
    const dir = join(projectsDir, encoded);
    try {
      if (!statSync(dir).isDirectory()) return EMPTY_RESULT;
    } catch {
      return EMPTY_RESULT;
    }
    projectDirs = [dir];
  } else {
    // Scan all project subdirectories.
    try {
      projectDirs = readdirSync(projectsDir)
        .map((name) => join(projectsDir, name))
        .filter((p) => {
          try {
            return statSync(p).isDirectory();
          } catch {
            return false;
          }
        });
    } catch {
      return EMPTY_RESULT;
    }
  }

  if (projectDirs.length === 0) return EMPTY_RESULT;

  // Aggregate across all project dirs and session files.
  const models = new Map<string, ModelAcc>();
  let totalSessions = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (const projectDir of projectDirs) {
    let files: string[];
    try {
      files = readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(projectDir, f));
    } catch {
      continue;
    }

    for (const filePath of files) {
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      let fileSessions = 0;
      const lines = content.split("\n");
      for (const line of lines) {
        if (!line?.includes("input_tokens")) continue;

        let parsed: UsageLine;
        try {
          parsed = JSON.parse(line) as UsageLine;
        } catch {
          continue; // malformed line — skip, don't abort
        }

        const usage = parsed.message?.usage;
        if (!usage) continue;

        // Timestamp filtering.
        if (parsed.timestamp) {
          const ts = new Date(parsed.timestamp).getTime() / 1000;
          if (since !== undefined && ts < since) continue;
          if (until !== undefined && ts > until) continue;
        }

        const model = parsed.message?.model ?? "(unknown)";
        const input = usage.input_tokens ?? 0;
        const output = usage.output_tokens ?? 0;
        const reasoning = usage.output_tokens_details?.thinking_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheWrite = usage.cache_creation_input_tokens ?? 0;

        // Only count the first usage line per file as a session.
        fileSessions++;

        let acc = models.get(model);
        if (!acc) {
          acc = {
            session_count: 0,
            tokens_input: 0,
            tokens_output: 0,
            tokens_reasoning: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            cost: 0,
          };
          models.set(model, acc);
        }
        acc.tokens_input += input;
        acc.tokens_output += output;
        acc.tokens_reasoning += reasoning;
        acc.tokens_cache_read += cacheRead;
        acc.tokens_cache_write += cacheWrite;

        totalInput += input;
        totalOutput += output;
        totalReasoning += reasoning;
        totalCacheRead += cacheRead;
        totalCacheWrite += cacheWrite;
      }

      if (fileSessions > 0) {
        totalSessions++;
        // Attribute 1 session to each model that appeared in this file.
        const seenModels = new Set<string>();
        for (const line of lines) {
          if (!line.includes("input_tokens")) continue;
          try {
            const parsed = JSON.parse(line) as UsageLine;
            const m = parsed.message?.model;
            if (m && !seenModels.has(m)) {
              seenModels.add(m);
              const acc = models.get(m);
              if (acc) acc.session_count++;
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    }
  }

  if (totalSessions === 0) return EMPTY_RESULT;

  const by_model: ModelBreakdown[] = [...models.entries()]
    .map(([model, acc]) => ({
      model,
      session_count: acc.session_count,
      tokens_input: acc.tokens_input,
      tokens_output: acc.tokens_output,
      tokens_reasoning: acc.tokens_reasoning,
      tokens_cache_read: acc.tokens_cache_read,
      tokens_cache_write: acc.tokens_cache_write,
      cost: acc.cost,
    }))
    .sort((a, b) => b.cost - a.cost || b.tokens_input - a.tokens_input);

  return {
    total_tokens_input: totalInput,
    total_tokens_output: totalOutput,
    total_tokens_reasoning: totalReasoning,
    total_tokens_cache_read: totalCacheRead,
    total_tokens_cache_write: totalCacheWrite,
    total_cost: 0, // Claude Code JSONL has no cost field
    session_count: totalSessions,
    by_model,
  };
}
