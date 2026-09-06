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
  roles?: {
    [name: string]: { cmd: string[]; model?: string; timeoutMin?: number };
  };
  review: {
    bigDiff: { files: number; lines: number };
    maxRounds: number;
    gate: string[];
    prefilter: null;
    autoLoop?: boolean;
  };
  memory: {
    claim: string[];
    close: string[];
    add: string[];
    kickoff?: string[];
  } | null;
  // Optional static pricing per role (USD per 1k tokens, input/output split).
  // Omit or null = byte measurement stays on, USD estimate stays off.
  // Example: { "executor": { "inputPer1k": 0.15, "outputPer1k": 0.6 } }
  pricing?: Record<string, { inputPer1k: number; outputPer1k: number }> | null;
  // opt-in only — omit or leave null to keep everything local. See TELEMETRY.md
  // for the exact payload shape (KPI numbers + event kind/timestamp, no
  // plan/commit/gate-note content, ever).
  telemetry: { enabled: boolean; endpoint: string } | null;
  // --- Flexible paths / markers / limits (all optional, defaults = old hardcodes) ---
  // prompts: role name → prompt template file (relative to fapony repo root or
  // absolute). Omit or null = fall back to the previous inline/builtin prompt.
  prompts?: {
    executor?: string | null;
    gate?: string | null;
    planner?: string | null;
    bigFixer?: string | null;
    scrutinizeFix?: string | null;
  } | null;
  spec?: {
    maxLines?: number;
    // regex source (no slashes/flags — always compiled with "m") matching the
    // plan header line; capture group 1 = raw spec ref.
    sourceMarker?: string;
  } | null;
  markers?: {
    handoff?: string;
    // regex sources for the gate verdict line; group 1 = pass|fail.
    verdict?: string;
    nextPrompt?: string;
    fileDone?: string;
    // regex source (no slashes/flags) for the shipped header; default matches
    // "> ✅ **shipped** (<hash>)".
    shipped?: string;
  } | null;
  paths?: {
    // state dir override (default: $XDG_CONFIG_HOME/fapony or ~/.config/fapony).
    // $FAPONY_STATE_DIR env wins over this when set.
    stateDir?: string;
    // plan/spec/memory layout inside each worktree (relative to worktree root).
    planDir?: string;
    specDir?: string;
    memoryEntry?: string;
    // archive subdir name for plan-mv (e.g. "done").
    doneDir?: string;
    // dirs scanned for inbound links by plan-mv (relative to repo root).
    linkScanDirs?: string[];
  } | null;
  safety?: {
    // regex sources tested against the joined argv; default = the 4 git patterns.
    deny?: string[];
  } | null;
  plan?: {
    extensions?: string[];
    // hygiene check: warn (never block) when a plan file exceeds this many
    // lines, or when section 7 balloons despite a linked Source spec.
    maxLines?: number;
  } | null;
  planmv?: {
    // "chore(plan): archive ..." commit template; vars {file} {hash}.
    archiveMsg?: string;
    inboundWarnAt?: number;
  } | null;
  display?: {
    dirtyPreview?: number;
    shortSha?: number;
  } | null;
  defaults?: {
    // fallback role timeout (minutes) when roles.<name>.timeoutMin is unset.
    timeoutMin?: number;
  } | null;
}

export const DEFAULT_SPEC_MAX_LINES = 200;
export const DEFAULT_PLAN_MAX_LINES = 200;
export const DEFAULT_SOURCE_MARKER = "^>\\s*\\*\\*Source spec:\\*\\*\\s*(.+)$";
export const DEFAULT_HANDOFF_MARKER = "## HANDOFF";
export const DEFAULT_VERDICT_RE = "^VERDICT:\\s*(pass|fail)\\s*$";
export const DEFAULT_NEXT_PROMPT_MARKER = "## NEXT-PROMPT";
export const DEFAULT_FILE_DONE_MARKER = "## FILE_DONE";
export const DEFAULT_SHIPPED_RE = "^>\\s*✅\\s*\\*\\*.*shipped.*\\*\\*";
export const DEFAULT_SAFETY_DENY = [
  "reset\\s+--hard",
  "clean\\s+-[a-z]*f",
  "checkout\\s+--\\s",
  "git\\s+stash",
];
export const DEFAULT_PLAN_DIR = ".fapony/plan";
export const DEFAULT_SPEC_DIR = ".fapony/spec";
export const DEFAULT_MEMORY_ENTRY = ".fapony/.memory/mem.ts";
export const DEFAULT_DONE_DIR = "done";
export const DEFAULT_LINK_SCAN_DIRS = [".fapony/plan/", ".fapony/spec/", "docs/"];
export const DEFAULT_PLAN_EXTENSIONS = [".md"];
export const DEFAULT_ARCHIVE_MSG = "chore(plan): archive {file} (shipped {hash})";
export const DEFAULT_INBOUND_WARN_AT = 5;
export const DEFAULT_DIRTY_PREVIEW = 10;
export const DEFAULT_SHORT_SHA = 8;
// Per-role spawn timeout fallbacks (minutes) — used only when neither
// roles.<name>.timeoutMin nor defaults.timeoutMin is set.
export const DEFAULT_ROLE_TIMEOUTS: Record<string, number> = {
  gate: 10,
  planner: 10,
  bigFixer: 20,
  scrutinizeFix: 15,
};

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
  telemetry: null,
  pricing: null,
  prompts: null,
  spec: null,
  markers: null,
  paths: null,
  safety: null,
  plan: null,
  planmv: null,
  display: null,
  defaults: null,
};

// XDG Base Directory convention (macOS ignores Apple's ~/Library/Application Support
// for CLI tools by common practice — gh, ripgrep-adjacent tools, etc. use ~/.config too)
// Override order: $FAPONY_STATE_DIR > config.paths.stateDir > $XDG_CONFIG_HOME > ~/.config
function faponyDir(config?: Config): string {
  if (process.env.FAPONY_STATE_DIR) return process.env.FAPONY_STATE_DIR;
  if (config?.paths?.stateDir) return config.paths.stateDir;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fapony");
}

function dbPath(config?: Config): string {
  return join(faponyDir(config), "state.db");
}

export function configFilePath(): string {
  if (process.env.FAPONY_CONFIG) return process.env.FAPONY_CONFIG;
  return join(process.cwd(), "fapony.config.json");
}

export function openDb(config?: Config): Database {
  const dir = faponyDir(config);
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

function freshDefaultConfig(): Config {
  return {
    ...DEFAULT_CONFIG,
    worktrees: { ...DEFAULT_CONFIG.worktrees },
    executor: { ...DEFAULT_CONFIG.executor },
    review: {
      ...DEFAULT_CONFIG.review,
      bigDiff: { ...DEFAULT_CONFIG.review.bigDiff },
    },
  };
}

export function loadConfig(configPath?: string): Config {
  const resolved = configPath ?? configFilePath();
  if (!existsSync(resolved)) return freshDefaultConfig();

  try {
    const raw = readFileSync(resolved, "utf-8");
    const file = JSON.parse(raw) as Partial<Config>;
    return {
      ...DEFAULT_CONFIG,
      ...file,
      executor: { ...DEFAULT_CONFIG.executor, ...file.executor },
      review: {
        ...DEFAULT_CONFIG.review,
        ...file.review,
        bigDiff: { ...DEFAULT_CONFIG.review.bigDiff, ...file.review?.bigDiff },
      },
      spec: file.spec ? { ...file.spec } : DEFAULT_CONFIG.spec,
      markers: file.markers ? { ...file.markers } : DEFAULT_CONFIG.markers,
      paths: file.paths ? { ...file.paths } : DEFAULT_CONFIG.paths,
      safety: file.safety ? { ...file.safety } : DEFAULT_CONFIG.safety,
      plan: file.plan ? { ...file.plan } : DEFAULT_CONFIG.plan,
      planmv: file.planmv ? { ...file.planmv } : DEFAULT_CONFIG.planmv,
      display: file.display ? { ...file.display } : DEFAULT_CONFIG.display,
      defaults: file.defaults ? { ...file.defaults } : DEFAULT_CONFIG.defaults,
      prompts: file.prompts ? { ...file.prompts } : DEFAULT_CONFIG.prompts,
    };
  } catch {
    return freshDefaultConfig();
  }
}

// --- Config getters (single place for every former hardcode) ---

export function specMaxLines(config: Config): number {
  return config.spec?.maxLines ?? DEFAULT_SPEC_MAX_LINES;
}

export function planMaxLines(config?: Config): number {
  return config?.plan?.maxLines ?? DEFAULT_PLAN_MAX_LINES;
}

export function sourceSpecRE(config?: Config): RegExp {
  return new RegExp(config?.spec?.sourceMarker ?? DEFAULT_SOURCE_MARKER, "m");
}

export function handoffMarker(config?: Config): string {
  return config?.markers?.handoff ?? DEFAULT_HANDOFF_MARKER;
}

export function verdictRE(config?: Config): RegExp {
  return new RegExp(config?.markers?.verdict ?? DEFAULT_VERDICT_RE, "m");
}

export function nextPromptMarker(config?: Config): string {
  return config?.markers?.nextPrompt ?? DEFAULT_NEXT_PROMPT_MARKER;
}

export function fileDoneMarker(config?: Config): string {
  return config?.markers?.fileDone ?? DEFAULT_FILE_DONE_MARKER;
}

export function shippedRE(config?: Config): RegExp {
  return new RegExp(config?.markers?.shipped ?? DEFAULT_SHIPPED_RE, "m");
}

export function safetyDeny(config?: Config): string[] {
  return config?.safety?.deny ?? DEFAULT_SAFETY_DENY;
}

export function planDir(config?: Config): string {
  return config?.paths?.planDir ?? DEFAULT_PLAN_DIR;
}

export function specDir(config?: Config): string {
  return config?.paths?.specDir ?? DEFAULT_SPEC_DIR;
}

export function memoryEntry(config?: Config): string {
  return config?.paths?.memoryEntry ?? DEFAULT_MEMORY_ENTRY;
}

export function doneDirName(config?: Config): string {
  return config?.paths?.doneDir ?? DEFAULT_DONE_DIR;
}

export function linkScanDirs(config?: Config): string[] {
  return config?.paths?.linkScanDirs ?? DEFAULT_LINK_SCAN_DIRS;
}

export function planExtensions(config?: Config): string[] {
  return config?.plan?.extensions ?? DEFAULT_PLAN_EXTENSIONS;
}

export function archiveMsg(config: Config, file: string, hash: string): string {
  const tpl = config.planmv?.archiveMsg ?? DEFAULT_ARCHIVE_MSG;
  return tpl.replaceAll("{file}", file).replaceAll("{hash}", hash);
}

export function inboundWarnAt(config?: Config): number {
  return config?.planmv?.inboundWarnAt ?? DEFAULT_INBOUND_WARN_AT;
}

export function dirtyPreviewLines(config?: Config): number {
  return config?.display?.dirtyPreview ?? DEFAULT_DIRTY_PREVIEW;
}

export function shortShaLen(config?: Config): number {
  return config?.display?.shortSha ?? DEFAULT_SHORT_SHA;
}

/** Model attribution for a role: roles.<name>.model or "" when unset. */
export function roleModel(config: Config, role: string): string {
  return config.roles?.[role]?.model ?? "";
}

export interface RolePricing {
  inputPer1k: number;
  outputPer1k: number;
}

/**
 * Static pricing for a role, or null when unconfigured.
 * pricing:null (or missing role) disables USD only — byte measurement stays on.
 */
export function pricingFor(config: Config, role: string): RolePricing | null {
  const p = config.pricing?.[role];
  if (!p) return null;
  if (typeof p.inputPer1k !== "number" || typeof p.outputPer1k !== "number") return null;
  return { inputPer1k: p.inputPer1k, outputPer1k: p.outputPer1k };
}

/** Role spawn timeout (minutes): roles.<name>.timeoutMin > defaults.timeoutMin > builtin. */
export function roleTimeoutMin(config: Config, role: string): number {
  return (
    config.roles?.[role]?.timeoutMin ??
    config.defaults?.timeoutMin ??
    DEFAULT_ROLE_TIMEOUTS[role] ??
    10
  );
}

/**
 * Resolve a prompt template file for a role.
 * Returns null when the role has no configured/file prompt (caller uses inline fallback).
 * Relative paths resolve against the fapony repo root (cwd at runtime).
 */
export function promptFileFor(
  config: Config,
  role: "executor" | "gate" | "planner" | "bigFixer" | "scrutinizeFix"
): string | null {
  const p = config.prompts?.[role];
  if (!p) return null;
  if (p.startsWith("/")) return p;
  return join(process.cwd(), p);
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

/**
 * Merge `patch` into an existing event's JSON data (keeps keys already set).
 * Used to complete a spawn row with bytes_out/usd after the agent finishes —
 * one row per spawn, timing (ts) stays at spawn start. No-op when the row
 * is missing or its data isn't a JSON object.
 */
export function updateEventData(
  db: Database,
  eventId: number,
  patch: Record<string, unknown>
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
    eventId
  );
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
  excludeRunId?: number
): string | null {
  const run = db
    .prepare(
      `SELECT * FROM runs WHERE worktree = ? AND mem_id = ? AND id != ? ORDER BY id DESC LIMIT 1`
    )
    .get(worktree, memId, excludeRunId ?? -1) as Run | null;
  if (!run || run.status !== "fixing") return null;

  const event = db
    .prepare(
      `SELECT * FROM events WHERE run_id = ? AND kind = 'gate' ORDER BY id DESC LIMIT 1`
    )
    .get(run.id) as Event | null;
  if (!event || !event.data) return null;

  try {
    const parsed = JSON.parse(event.data) as { verdict?: string; note?: string };
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
  memId: string
): { kind: "next_prompt" | "file_done"; text: string } | null {
  const run = db
    .prepare(
      `SELECT id FROM runs WHERE worktree = ? AND mem_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(worktree, memId) as { id: number } | null;
  if (!run) return null;

  const event = db
    .prepare(
      `SELECT data FROM events WHERE run_id = ? AND kind = 'plan' ORDER BY id DESC LIMIT 1`
    )
    .get(run.id) as { data: string | null } | null;
  if (!event || !event.data) return null;

  try {
    const parsed = JSON.parse(event.data) as { kind?: string; text?: string };
    if (parsed.kind && parsed.text) {
      return { kind: parsed.kind as "next_prompt" | "file_done", text: parsed.text };
    }
  } catch {}
  return null;
}
