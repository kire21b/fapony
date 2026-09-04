import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type RunStatus =
  | "running"
  | "awaiting_review"
  | "fixing"
  | "passed"
  | "stopped"
  | "stalled";

export interface Run {
  id: number;
  worktree: string;
  plan: string | null;
  mem_id: string | null;
  status: RunStatus;
  base_sha: string;
  round: number;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  run_id: number;
  ts: string;
  kind: string;
  data: string | null;
}

export interface Config {
  worktrees: Record<string, string>;
  executor: { cmd: string[]; timeoutMin: number };
  review: {
    bigDiff: { files: number; lines: number };
    maxRounds: number;
    gate: string[];
    prefilter: null;
  };
  memory: {
    claim: string[];
    close: string[];
    add: string[];
    kickoff?: string[];
  } | null;
}

const DEFAULT_CONFIG: Config = {
  worktrees: {},
  executor: { cmd: ["opencode", "run"], timeoutMin: 45 },
  review: {
    bigDiff: { files: 15, lines: 400 },
    maxRounds: 2,
    gate: ["claude", "-p", "/code-review high"],
    prefilter: null,
  },
  memory: null,
};

// XDG Base Directory convention (macOS ignores Apple's ~/Library/Application Support
// for CLI tools by common practice — gh, ripgrep-adjacent tools, etc. use ~/.config too)
function faponyDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fapony");
}

function dbPath(): string {
  return join(faponyDir(), "state.db");
}

export function openDb(): Database {
  const dir = faponyDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath());
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

export function loadConfig(): Config {
  const configPath = join(process.cwd(), "fapony.config.json");
  if (!existsSync(configPath)) return DEFAULT_CONFIG;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const file = JSON.parse(raw) as Partial<Config>;
    return {
      ...DEFAULT_CONFIG,
      ...file,
      executor: { ...DEFAULT_CONFIG.executor, ...file.executor },
      review: { ...DEFAULT_CONFIG.review, ...file.review },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function newRun(
  db: Database,
  worktree: string,
  plan: string | null,
  memId: string | null,
  baseSha: string
): number {
  const stmt = db.prepare(
    `INSERT INTO runs (worktree, plan, mem_id, status, base_sha, round)
     VALUES (?, ?, ?, 'running', ?, 0)`
  );
  const result = stmt.run(worktree, plan, memId, baseSha);
  return Number(result.lastInsertRowid);
}

export function setStatus(
  db: Database,
  runId: number,
  status: RunStatus
): void {
  db.prepare(
    `UPDATE runs SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, runId);
}

export function incrementRound(db: Database, runId: number): void {
  db.prepare(
    `UPDATE runs SET round = round + 1, updated_at = datetime('now') WHERE id = ?`
  ).run(runId);
}

export function addEvent(
  db: Database,
  runId: number,
  kind: string,
  data: unknown
): number {
  const stmt = db.prepare(
    `INSERT INTO events (run_id, kind, data) VALUES (?, ?, ?)`
  );
  const result = stmt.run(runId, kind, JSON.stringify(data));
  return Number(result.lastInsertRowid);
}

export function getRun(db: Database, runId: number): Run | null {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as
    | Run
    | null;
}

export function getActiveRuns(db: Database): Run[] {
  return db
    .prepare(
      "SELECT * FROM runs WHERE status NOT IN ('passed', 'stopped') ORDER BY id"
    )
    .all() as Run[];
}

export function getEvents(db: Database, runId: number): Event[] {
  return db
    .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY id")
    .all(runId) as Event[];
}
