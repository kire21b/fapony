// src/session/findModel.ts — resolve model+provider from a session_id
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

export interface SessionModel {
  model: string;
  provider: string;
}

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
            provider: parsed.providerID ?? "",
          };
        }
      } catch {
        // fall through to plain text
      }
      return { model: row.model, provider: "" };
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

    // ZCode: session has no model column — model lives in model_usage
    const row = db
      .prepare(
        `SELECT mu.model_id AS model
         FROM model_usage mu
         JOIN session s ON mu.session_id = s.id
         WHERE s.id = ?
         LIMIT 1`,
      )
      .get(sessionId) as { model: string } | null;

    if (!row) return null;
    return { model: row.model, provider: "" };
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

  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.includes("input_tokens")) continue;
    try {
      const parsed = JSON.parse(line) as {
        message?: { model?: string };
      };
      if (typeof parsed.message?.model === "string" && parsed.message.model) {
        return { model: parsed.message.model, provider: "anthropic" };
      }
    } catch {
      // skip malformed
    }
  }
  return null;
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

  const lines = content.split("\n");
  for (const line of lines) {
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
          return { model, provider: parsed.payload.model_provider ?? "" };
        }
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

/**
 * Resolve model+provider from a session_id by trying each client reader.
 * Returns null when not found in any session log.
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
