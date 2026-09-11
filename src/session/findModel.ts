// src/session/findModel.ts — resolve model+provider+client+agent from a session_id
//
// Tries each client reader in order: OpenCode → ZCode → Claude Code → Codex.
// Returns null when the id is not found in any session log. Never throws —
// a missing session is a normal "no signal" case, not an error.
//
// OpenCode/ZCode: query the session table by id directly — never scan part table.
// Claude Code/Codex: session_id is a .jsonl file path — check existsSync first.

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SessionClient = "opencode" | "zcode" | "claude-code" | "codex";

export interface SessionModel {
  model: string;
  /** Provider as the client logs it (raw — never mapped); "—" when unknown. */
  provider: string;
  client: SessionClient;
  /** Subagent name (ZCode model_usage.agent only); null elsewhere. */
  agent: string | null;
}

/** Single unknown-value sentinel — never "" or "(unknown)" (see task). */
const UNKNOWN = "—";

function resolveOpenCodeDbPath(): string {
  return (
    process.env.FAPONY_OPENCODE_DB ??
    join(homedir(), ".local", "share", "opencode", "opencode.db")
  );
}

function resolveZcodeDbPath(): string {
  return (
    process.env.FAPONY_ZCODE_DB ??
    join(homedir(), ".zcode", "cli", "db", "db.sqlite")
  );
}

function findInOpenCode(sessionId: string): SessionModel | null {
  // NOTE: session.model is the *current* model, not the majority one — a
  // mid-run /model switch leaves only the latest here. That's the best this
  // reader can do: never scan the part table for this (per-task rule).
  const dbPath = resolveOpenCodeDbPath();
  if (!existsSync(dbPath)) return null;

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    db.run("PRAGMA query_only = ON");

    const row = db
      .prepare(`SELECT model FROM session WHERE id = ?`)
      .get(sessionId) as { model: string } | null;

    if (!row) return null;

    // model column is either plain text or JSON {providerID, id}
    if (typeof row.model === "string") {
      try {
        if (row.model.startsWith("{")) {
          const parsed = JSON.parse(row.model) as {
            providerID?: string;
            id?: string;
          };
          return {
            model: parsed.id ?? row.model,
            provider: parsed.providerID || UNKNOWN,
            client: "opencode",
            agent: null,
          };
        }
      } catch {
        // fall through to plain text
      }
      return {
        model: row.model,
        provider: UNKNOWN,
        client: "opencode",
        agent: null,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function findInZcode(sessionId: string): SessionModel | null {
  const dbPath = resolveZcodeDbPath();
  if (!existsSync(dbPath)) return null;

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    db.run("PRAGMA query_only = ON");

    // ZCode: session has no model column — model lives in model_usage, one
    // row per request, so a mid-run /model switch leaves several model_ids.
    // Majority rule (same as the JSONL readers): the (model, provider,
    // agent) group with the most summed computed_total_tokens — a single
    // big row must not beat many small rows doing most of the work
    // (no JOIN — no session column is used, and session_id is FK'd anyway).
    // provider_id is taken raw (sometimes a UUID, never mapped).
    const row = db
      .prepare(
        `SELECT model_id AS model, provider_id AS provider, agent
         FROM model_usage
         WHERE session_id = ?
         GROUP BY model_id, provider_id, agent
         ORDER BY SUM(computed_total_tokens) DESC
         LIMIT 1`,
      )
      .get(sessionId) as {
      model: string;
      provider: string | null;
      agent: string | null;
    } | null;

    if (!row) return null;
    return {
      model: row.model,
      provider: row.provider || UNKNOWN,
      client: "zcode",
      agent: row.agent ?? null,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function findInClaudeCode(sessionId: string): SessionModel | null {
  // Claude Code: session_id is a .jsonl file path
  if (!existsSync(sessionId)) return null;

  let content: string;
  try {
    content = readFileSync(sessionId, "utf-8");
  } catch {
    return null;
  }

  // One session routinely uses several models (Opus diagnose → /model
  // Sonnet to implement), so count message.model on every line and return the
  // majority — never the first hit. Tie → last seen. Verified on real data:
  // opus first (122 turns) but sonnet the worker (572 turns) must win.
  const counts = new Map<string, number>();
  const lastIdx = new Map<string, number>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as {
        message?: { model?: string };
      };
      const m = parsed.message?.model;
      if (typeof m === "string" && m) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
        lastIdx.set(m, i);
      }
    } catch {
      // skip malformed
    }
  }
  let best: string | null = null;
  for (const [m, c] of counts) {
    if (
      best === null ||
      c > (counts.get(best) ?? 0) ||
      (c === (counts.get(best) ?? 0) &&
        (lastIdx.get(m) ?? 0) > (lastIdx.get(best) ?? 0))
    ) {
      best = m;
    }
  }
  return best
    ? { model: best, provider: "anthropic", client: "claude-code", agent: null }
    : null;
}

function findInCodex(sessionId: string): SessionModel | null {
  // Codex: session_id is a .jsonl file path
  if (!existsSync(sessionId)) return null;

  let content: string;
  try {
    content = readFileSync(sessionId, "utf-8");
  } catch {
    return null;
  }

  // session_meta normally appears exactly once per file (verified: 59/59
  // on this machine), but count anyway — same majority/tie→last rule as
  // Claude Code in case a rollout ever carries several.
  const counts = new Map<
    string,
    { n: number; lastIdx: number; provider: string }
  >();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        payload?: {
          model?: string;
          model_provider?: string;
          base_instructions?: { provenance?: { model?: string } };
        };
      };
      if (parsed.type === "session_meta" && parsed.payload) {
        const model =
          parsed.payload.model ??
          parsed.payload.base_instructions?.provenance?.model;
        if (model) {
          const prev = counts.get(model);
          counts.set(model, {
            n: (prev?.n ?? 0) + 1,
            lastIdx: i,
            provider: parsed.payload.model_provider ?? prev?.provider ?? "",
          });
        }
      }
    } catch {
      // skip malformed
    }
  }
  let best: string | null = null;
  for (const [m, s] of counts) {
    const b = best === null ? undefined : counts.get(best);
    if (!b || s.n > b.n || (s.n === b.n && s.lastIdx > b.lastIdx)) {
      best = m;
    }
  }
  if (!best) return null;
  return {
    model: best,
    provider: counts.get(best)?.provider || UNKNOWN,
    client: "codex",
    agent: null,
  };
}

/**
 * Resolve model+provider+client+agent from a session_id by trying each
 * client reader. Returns null when not found in any session log.
 */
export function findSessionModel(sessionId: string): SessionModel | null {
  if (typeof sessionId !== "string" || !sessionId) return null;

  return (
    findInOpenCode(sessionId) ??
    findInZcode(sessionId) ??
    findInClaudeCode(sessionId) ??
    findInCodex(sessionId)
  );
}
