// src/session/activeSession.ts — infer which client session was live at a
// point in time, so a verdict submitted without session_id still gets model
// attribution.
//
// Why inference instead of asking for session_id: an optional field nobody
// fills collects nothing (17 gate events on this machine, 2 with a session
// id). Every client already records, per session, the directory it ran in
// and when it was active — that is enough to answer "who was working in this
// worktree at 14:32" without asking the caller for anything.
//
// Read-time only: nothing here is written to the db, so it attributes
// history retroactively and stays consistent with how session_id-based
// attribution already resolves (gates.ts). The cost is the same too — when
// a client prunes its session log, attribution for those rows goes with it.
//
// Codex is deliberately absent: its logs are nested per-date with cwd inside
// the payload, so spans need a directory walk, not a query. Add it when
// Codex is actually in the rotation.

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionClient } from "./findModel.js";

export interface SessionSpan {
  sessionId: string;
  client: SessionClient;
  /** Directory the client ran in, as the client recorded it. */
  worktree: string;
  startMs: number;
  endMs: number;
}

function sqliteSpans(dbPath: string, client: SessionClient): SessionSpan[] {
  if (!existsSync(dbPath)) return [];
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    db.run("PRAGMA query_only = ON");
    const rows = db
      .prepare(
        `SELECT id, directory, time_created, time_updated
         FROM session
         WHERE directory IS NOT NULL AND directory != ''`,
      )
      .all() as {
      id: string;
      directory: string;
      time_created: number;
      time_updated: number;
    }[];
    return rows.map((r) => ({
      sessionId: r.id,
      client,
      worktree: r.directory,
      startMs: r.time_created,
      endMs: Math.max(r.time_updated, r.time_created),
    }));
  } catch {
    return []; // schema drift or a locked db is "no signal", never an error
  } finally {
    db?.close();
  }
}

/** Claude Code's per-project dir name: every non-alphanumeric byte becomes '-'. */
export function claudeProjectSlug(worktree: string): string {
  return worktree.replace(/[^a-zA-Z0-9]/g, "-");
}

function claudeCodeSpans(worktree: string): SessionSpan[] {
  const dir = join(
    homedir(),
    ".claude",
    "projects",
    claudeProjectSlug(worktree),
  );
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: SessionSpan[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      // Append-only transcripts: birthtime→mtime is the session's live span.
      const st = statSync(path);
      out.push({
        sessionId: path, // Claude Code's session id IS the file path
        client: "claude-code",
        worktree,
        startMs: st.birthtimeMs || st.mtimeMs,
        endMs: st.mtimeMs,
      });
    } catch {
      // vanished mid-scan — skip
    }
  }
  return out;
}

/**
 * Every session span that ran in `worktree`, across clients.
 * Scoped by worktree on purpose: Claude Code stores one directory per
 * project, so scanning globally would mean reading every project's folder.
 */
export function loadSessionSpans(worktree: string): SessionSpan[] {
  const openCodeDb =
    process.env.FAPONY_OPENCODE_DB ??
    join(homedir(), ".local", "share", "opencode", "opencode.db");
  const zcodeDb =
    process.env.FAPONY_ZCODE_DB ??
    join(homedir(), ".zcode", "cli", "db", "db.sqlite");
  return [
    ...sqliteSpans(openCodeDb, "opencode").filter(
      (s) => s.worktree === worktree,
    ),
    ...sqliteSpans(zcodeDb, "zcode").filter((s) => s.worktree === worktree),
    ...claudeCodeSpans(worktree),
  ];
}

/**
 * The session that was live at `atMs`, or null when none was.
 *
 * Containment, not recency: a span must actually cover the timestamp. When
 * several do (two clients open in the same worktree), the narrowest wins —
 * the more specific claim on that moment. This is a guess either way, so
 * callers must label it inferred and never treat it as the caller's own
 * declared session_id.
 */
export function findSessionAt(
  spans: SessionSpan[],
  atMs: number,
  graceMs = 120_000,
): SessionSpan | null {
  let best: SessionSpan | null = null;
  let bestWidth = Number.POSITIVE_INFINITY;
  for (const s of spans) {
    // grace on the end: a verdict lands a beat before the transcript flushes.
    if (atMs < s.startMs || atMs > s.endMs + graceMs) continue;
    const width = s.endMs - s.startMs;
    if (width < bestWidth) {
      best = s;
      bestWidth = width;
    }
  }
  return best;
}
