import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { faponyDir } from "./load.js";
import type { Config, Event, Run, RunStatus } from "./types.js";

export function openDb(config?: Config): Database {
  const dir = faponyDir(config);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(`${dir}/state.db`);
  db.exec("PRAGMA journal_mode=WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs(
      id INTEGER PRIMARY KEY,
      worktree TEXT NOT NULL,
      plan TEXT,
      mem_id TEXT,
      status TEXT NOT NULL,
      base_sha TEXT NOT NULL DEFAULT '',
      round INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL,
      data TEXT
    )
  `);

  return db;
}

export function newRun(
  db: Database,
  worktree: string,
  plan: string | null,
  memId: string | null,
  baseSha: string,
): number {
  const stmt = db.prepare(
    `INSERT INTO runs (worktree, plan, mem_id, status, base_sha, round)
     VALUES (?, ?, ?, 'running', ?, 0)`,
  );
  const result = stmt.run(worktree, plan, memId, baseSha);
  return Number(result.lastInsertRowid);
}

export function setStatus(
  db: Database,
  runId: number,
  status: RunStatus,
): void {
  db.prepare(
    `UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, runId);
}

export function incrementRound(db: Database, runId: number): void {
  db.prepare(
    `UPDATE runs SET round = round + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(runId);
}

export function addEvent(
  db: Database,
  runId: number,
  kind: string,
  data: unknown,
): number {
  const stmt = db.prepare(
    `INSERT INTO events (run_id, kind, data) VALUES (?, ?, ?)`,
  );
  const result = stmt.run(runId, kind, JSON.stringify(data));
  return Number(result.lastInsertRowid);
}

/**
 * Merge `patch` into an existing event's JSON data (keeps keys already set).
 * Used to complete a spawn row with bytes_out/usd after the agent finishes —
 * one row per spawn, timing (ts) stays at spawn start. No-op when the row
 * is missing or its data isn't a JSON object.
 */
export function updateEventData(
  db: Database,
  eventId: number,
  patch: Record<string, unknown>,
): void {
  const row = db
    .prepare("SELECT data FROM events WHERE id = ?")
    .get(eventId) as { data: string | null } | null;
  if (!row) return;
  let base: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.data ?? "null") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      base = parsed as Record<string, unknown>;
    }
  } catch {
    return;
  }
  db.prepare("UPDATE events SET data = ? WHERE id = ?").run(
    JSON.stringify({ ...base, ...patch }),
    eventId,
  );
}

export function getRun(db: Database, runId: number): Run | null {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Run | null;
}

export function getActiveRuns(db: Database): Run[] {
  return db
    .prepare(
      "SELECT * FROM runs WHERE status NOT IN ('passed', 'stopped') ORDER BY id",
    )
    .all() as Run[];
}

export function getEvents(db: Database, runId: number): Event[] {
  return db
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY id")
    .all(runId) as Event[];
}

/**
 * Pulls the most recent unresolved "gate fail" note for a worktree+mem_id pair —
 * i.e. the review feedback the next `fapony run` should hand back to the executor.
 * Only looks at the latest run for that pair; if it already passed, returns null
 * (nothing to carry forward).
 */
export function getPendingFeedback(
  db: Database,
  worktree: string,
  memId: string,
  excludeRunId?: number,
): string | null {
  const run = db
    .prepare(
      `SELECT * FROM runs WHERE worktree = ? AND mem_id = ? AND id != ? ORDER BY id DESC LIMIT 1`,
    )
    .get(worktree, memId, excludeRunId ?? -1) as Run | null;
  if (run?.status !== "fixing") return null;

  const event = db
    .prepare(
      `SELECT * FROM events WHERE run_id = ? AND kind = 'gate' ORDER BY id DESC LIMIT 1`,
    )
    .get(run.id) as Event | null;
  if (!event?.data) return null;

  try {
    const parsed = JSON.parse(event.data) as {
      verdict?: string;
      note?: string;
    };
    return parsed.verdict === "fail" && parsed.note ? parsed.note : null;
  } catch {
    return null;
  }
}

/**
 * Pulls the most recent planner output (NEXT-PROMPT or FILE_DONE) for a worktree+mem_id pair.
 * Used by loop.ts to resolve {{PLAN}} from planner events when no plan file is specified.
 * Returns { kind, text } or null if no plan event exists.
 */
export function getLastPlanUpdate(
  db: Database,
  worktree: string,
  memId: string,
): { kind: "next_prompt" | "file_done"; text: string } | null {
  const run = db
    .prepare(
      `SELECT id FROM runs WHERE worktree = ? AND mem_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(worktree, memId) as { id: number } | null;
  if (!run) return null;

  const event = db
    .prepare(
      `SELECT data FROM events WHERE run_id = ? AND kind = 'plan' ORDER BY id DESC LIMIT 1`,
    )
    .get(run.id) as { data: string | null } | null;
  if (!event?.data) return null;

  try {
    const parsed = JSON.parse(event.data) as { kind?: string; text?: string };
    if (parsed.kind && parsed.text) {
      return {
        kind: parsed.kind as "next_prompt" | "file_done",
        text: parsed.text,
      };
    }
  } catch {}
  return null;
}
