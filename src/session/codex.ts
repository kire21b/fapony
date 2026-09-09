// src/session/codex.ts — Codex passive usage reader
//
// Reads ~/.codex/sessions/**/*.jsonl (one file per rollout session).
// Each line is a JSON object; usage data lives in type: "token_usage_record"
// payloads. No cost field — total_cost is always 0.
//
// No detail (tool/step breakdown) in v1 — Codex JSONL has no equivalent.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_RESULT,
  type ModelBreakdown,
  type PassiveUsageResult,
} from "./types.js";

const SESSIONS_DIR = join(homedir(), ".codex", "sessions");

function resolveSessionsDir(optDir?: string): string {
  return optDir ?? process.env.FAPONY_CODEX_SESSIONS_DIR ?? SESSIONS_DIR;
}

interface TokenUsageRecord {
  session_id: string;
  thread_id?: string;
  turn_id?: string;
  root_turn_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
  };
  turn_token_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
  };
  thread_token_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
  };
}

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    session_id?: string;
    cwd?: string;
    usage?: TokenUsageRecord["usage"];
    turn_token_usage?: TokenUsageRecord["turn_token_usage"];
    thread_token_usage?: TokenUsageRecord["thread_token_usage"];
    // session_meta fields
    model_provider?: string;
    model?: string;
    base_instructions?: {
      provenance?: {
        model?: string;
      };
    };
  };
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

function walkJsonl(dir: string): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        files.push(...walkJsonl(full));
      } else if (entry.endsWith(".jsonl")) {
        files.push(full);
      }
    } catch {
      // skip inaccessible entries
    }
  }
  return files;
}

/**
 * Read passive usage from Codex JSONL session files.
 * Returns EMPTY_RESULT when the sessions dir is missing, inaccessible,
 * or has no qualifying token records.
 */
export function readCodexUsage(
  worktree?: string,
  since?: number,
  until?: number,
): PassiveUsageResult {
  const sessionsDir = resolveSessionsDir();
  try {
    if (!statSync(sessionsDir).isDirectory()) return EMPTY_RESULT;
  } catch {
    return EMPTY_RESULT;
  }

  const files = walkJsonl(sessionsDir);
  if (files.length === 0) return EMPTY_RESULT;

  const models = new Map<string, ModelAcc>();
  let totalSessions = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Track per-file state for session attribution.
    const fileSessions = new Set<string>();
    let fileCwd: string | undefined;
    let fileTimestamp: string | undefined;
    let fileModel: string | undefined;
    let hasTokenUsage = false;

    const lines = content.split("\n");
    for (const line of lines) {
      if (!line) continue;

      let parsed: CodexLine;
      try {
        parsed = JSON.parse(line) as CodexLine;
      } catch {
        continue; // malformed line — skip, don't abort
      }

      if (parsed.type === "session_meta" && parsed.payload) {
        fileCwd = parsed.payload.cwd;
        fileTimestamp = parsed.timestamp;
        // Model can be in payload.model or payload.base_instructions.provenance.model
        fileModel =
          parsed.payload.model ??
          parsed.payload.base_instructions?.provenance?.model;
        continue;
      }

      if (parsed.type === "token_usage_record" && parsed.payload) {
        const rec = parsed.payload;
        const usage = rec.usage ?? rec.turn_token_usage;
        if (!usage) continue;

        // Worktree filtering.
        if (worktree && fileCwd && fileCwd !== worktree) continue;

        // Timestamp filtering — use the line's own timestamp as fallback.
        const ts = parsed.timestamp ?? fileTimestamp;
        if (ts) {
          const epoch = new Date(ts).getTime() / 1000;
          if (since !== undefined && epoch < since) continue;
          if (until !== undefined && epoch > until) continue;
        }

        const sessionId = rec.session_id ?? "unknown";
        const model = fileModel ?? "(unknown)";
        const input = usage.input_tokens ?? 0;
        const output = usage.output_tokens ?? 0;
        const reasoning = usage.reasoning_output_tokens ?? 0;
        const cacheRead = usage.cached_input_tokens ?? 0;
        const cacheWrite = usage.cache_write_input_tokens ?? 0;

        // Only count each session id once per file.
        fileSessions.add(sessionId);
        hasTokenUsage = true;

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
    }

    if (hasTokenUsage && fileSessions.size > 0) {
      totalSessions += fileSessions.size;
      // Attribute 1 session to each model that appeared in this file.
      const seenModels = new Set<string>();
      for (const line of lines) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as CodexLine;
          if (parsed.type === "session_meta" && parsed.payload) {
            const m =
              parsed.payload.model ??
              parsed.payload.base_instructions?.provenance?.model;
            if (m && !seenModels.has(m)) {
              seenModels.add(m);
              const acc = models.get(m);
              if (acc) acc.session_count++;
            }
          }
        } catch {
          /* skip malformed */
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
    total_cost: 0, // Codex JSONL has no cost field
    session_count: totalSessions,
    by_model,
  };
}
