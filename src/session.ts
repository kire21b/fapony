import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ModelBreakdown {
  model: string;
  session_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost: number;
}

export interface SessionDetail {
  session_id: string;
  model: string;
  steps: number;
  tools: Record<string, number>;
}

export interface UsageDetail {
  /** Global tool-call counts across the filtered sessions (activity signal, not quality). */
  tool_breakdown: Record<string, number>;
  /** Total step-finish parts across the filtered sessions. */
  steps: number;
  /** Per-session breakdown (SQL-aggregated, never raw part rows). */
  by_session: SessionDetail[];
  /**
   * Step-token sums are NOT reported: per-step tokens overlap (each step
   * carries the full context window), so SUM(step tokens) >> session tokens.
   * Verified on real data — see testSessionDetailStepTokensNotSummed.
   */
  note: string;
}

export interface PassiveUsageResult {
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens_reasoning: number;
  total_tokens_cache_read: number;
  total_tokens_cache_write: number;
  total_cost: number;
  session_count: number;
  by_model: ModelBreakdown[];
  /** Present only when detail:true was requested (additive, default absent). */
  detail?: UsageDetail | null;
}

const DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

function resolveDbPath(optDbPath?: string): string {
  return optDbPath ?? process.env.FAPONY_OPENCODE_DB ?? DB_PATH;
}

const EMPTY_RESULT: PassiveUsageResult = {
  total_tokens_input: 0,
  total_tokens_output: 0,
  total_tokens_reasoning: 0,
  total_tokens_cache_read: 0,
  total_tokens_cache_write: 0,
  total_cost: 0,
  session_count: 0,
  by_model: [],
};

export function readPassiveUsage(
  worktree?: string,
  since?: number,
  until?: number,
  detailOrOpts?: boolean | { detail?: boolean; dbPath?: string },
): PassiveUsageResult {
  const detail =
    typeof detailOrOpts === "boolean" ? detailOrOpts : !!detailOrOpts?.detail;
  const dbPath =
    typeof detailOrOpts === "object"
      ? resolveDbPath(detailOrOpts.dbPath)
      : resolveDbPath();
  if (!existsSync(dbPath)) {
    return EMPTY_RESULT;
  }

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    db.exec("PRAGMA query_only = ON");

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (worktree) {
      conditions.push("p.worktree = ?");
      params.push(worktree);
    }
    if (since !== undefined) {
      conditions.push("s.time_created >= ?");
      params.push(since);
    }
    if (until !== undefined) {
      conditions.push("s.time_created <= ?");
      params.push(until);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalsRow = db
      .prepare(`
        SELECT
          COALESCE(SUM(s.tokens_input), 0) AS total_tokens_input,
          COALESCE(SUM(s.tokens_output), 0) AS total_tokens_output,
          COALESCE(SUM(s.tokens_reasoning), 0) AS total_tokens_reasoning,
          COALESCE(SUM(s.tokens_cache_read), 0) AS total_tokens_cache_read,
          COALESCE(SUM(s.tokens_cache_write), 0) AS total_tokens_cache_write,
          COALESCE(SUM(s.cost), 0) AS total_cost,
          COUNT(*) AS session_count
        FROM session s
        JOIN project p ON s.project_id = p.id
        ${whereClause}
      `)
      .get(...params) as {
      total_tokens_input: number;
      total_tokens_output: number;
      total_tokens_reasoning: number;
      total_tokens_cache_read: number;
      total_tokens_cache_write: number;
      total_cost: number;
      session_count: number;
    };

    if (!totalsRow || totalsRow.session_count === 0) {
      return EMPTY_RESULT;
    }

    const byModelRows = db
      .prepare(`
        SELECT
          s.model AS model,
          COUNT(*) AS session_count,
          SUM(s.tokens_input) AS tokens_input,
          SUM(s.tokens_output) AS tokens_output,
          SUM(s.tokens_reasoning) AS tokens_reasoning,
          SUM(s.tokens_cache_read) AS tokens_cache_read,
          SUM(s.tokens_cache_write) AS tokens_cache_write,
          SUM(s.cost) AS cost
        FROM session s
        JOIN project p ON s.project_id = p.id
        ${whereClause}
        GROUP BY s.model
        ORDER BY cost DESC
      `)
      .all(...params) as ModelBreakdown[];

    const result: PassiveUsageResult = {
      total_tokens_input: totalsRow.total_tokens_input,
      total_tokens_output: totalsRow.total_tokens_output,
      total_tokens_reasoning: totalsRow.total_tokens_reasoning,
      total_tokens_cache_read: totalsRow.total_tokens_cache_read,
      total_tokens_cache_write: totalsRow.total_tokens_cache_write,
      total_cost: totalsRow.total_cost,
      session_count: totalsRow.session_count,
      by_model: byModelRows,
    };

    if (detail) {
      result.detail = readUsageDetail(db, worktree, since, until);
    }

    return result;
  } catch {
    return EMPTY_RESULT;
  } finally {
    db?.close();
  }
}

// --- Detail (opt-in): tool-call + step breakdown from the part table ---
//
// part has NO type/time columns — type lives in json_extract(data,'$.type').
// Only two known types are queried ('tool', 'step-finish'); anything else is
// never selected (unknown type → skip, per PLAN-usage-depth §5). Only the
// tool NAME + counts are stored — input/output blobs are never selected.
// All aggregation happens in SQL (GROUP BY), raw part rows never leave sqlite.

const STEP_TOKENS_NOTE =
  "step tokens overlap (per-step context window) — SUM(step tokens) != session tokens; steps is a count only";

function buildSessionFilter(
  worktree?: string,
  since?: number,
  until?: number,
): { clause: string; params: (string | number)[] } {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (worktree) {
    conds.push("pr.worktree = ?");
    params.push(worktree);
  }
  if (since !== undefined) {
    conds.push("s.time_created >= ?");
    params.push(since);
  }
  if (until !== undefined) {
    conds.push("s.time_created <= ?");
    params.push(until);
  }
  return {
    clause: conds.length > 0 ? `AND ${conds.join(" AND ")}` : "",
    params,
  };
}

function readUsageDetail(
  db: Database,
  worktree?: string,
  since?: number,
  until?: number,
): UsageDetail {
  const filter = buildSessionFilter(worktree, since, until);

  const toolRows = db
    .prepare(
      `
      SELECT json_extract(p.data, '$.tool') AS tool, COUNT(*) AS c
      FROM part p
      JOIN session s ON s.id = p.session_id
      JOIN project pr ON pr.id = s.project_id
      WHERE json_extract(p.data, '$.type') = 'tool'
      ${filter.clause}
      GROUP BY tool
      ORDER BY c DESC
    `,
    )
    .all(...filter.params) as Array<{ tool: string | null; c: number }>;

  const tool_breakdown: Record<string, number> = {};
  for (const r of toolRows) {
    const name = typeof r.tool === "string" && r.tool ? r.tool : "(unknown)";
    tool_breakdown[name] = r.c;
  }

  const stepsRow = db
    .prepare(
      `
      SELECT COUNT(*) AS steps
      FROM part p
      JOIN session s ON s.id = p.session_id
      JOIN project pr ON pr.id = s.project_id
      WHERE json_extract(p.data, '$.type') = 'step-finish'
      ${filter.clause}
    `,
    )
    .get(...filter.params) as { steps: number };

  const perSessionSteps = db
    .prepare(
      `
      SELECT p.session_id AS sid, s.model AS model, COUNT(*) AS steps
      FROM part p
      JOIN session s ON s.id = p.session_id
      JOIN project pr ON pr.id = s.project_id
      WHERE json_extract(p.data, '$.type') = 'step-finish'
      ${filter.clause}
      GROUP BY sid
    `,
    )
    .all(...filter.params) as Array<{
    sid: string;
    model: string | null;
    steps: number;
  }>;

  const perSessionTools = db
    .prepare(
      `
      SELECT p.session_id AS sid, json_extract(p.data, '$.tool') AS tool, COUNT(*) AS c
      FROM part p
      JOIN session s ON s.id = p.session_id
      JOIN project pr ON pr.id = s.project_id
      WHERE json_extract(p.data, '$.type') = 'tool'
      ${filter.clause}
      GROUP BY sid, tool
    `,
    )
    .all(...filter.params) as Array<{
    sid: string;
    tool: string | null;
    c: number;
  }>;

  const bySessionMap = new Map<string, SessionDetail>();
  for (const r of perSessionSteps) {
    bySessionMap.set(r.sid, {
      session_id: r.sid,
      model: typeof r.model === "string" ? r.model : "(unknown)",
      steps: r.steps,
      tools: {},
    });
  }
  for (const r of perSessionTools) {
    let entry = bySessionMap.get(r.sid);
    if (!entry) {
      entry = {
        session_id: r.sid,
        model: "(unknown)",
        steps: 0,
        tools: {},
      };
      bySessionMap.set(r.sid, entry);
    }
    // Model for tool-only sessions: filled below from session table fallback.
    const name = typeof r.tool === "string" && r.tool ? r.tool : "(unknown)";
    entry.tools[name] = r.c;
  }

  // Sessions that have tools but no step-finish rows lack a model above —
  // backfill it with one cheap lookup (still SQL-aggregated, no raw parts).
  const missingModel = [...bySessionMap.values()]
    .filter((e) => e.model === "(unknown)")
    .map((e) => e.session_id);
  if (missingModel.length > 0) {
    const placeholders = missingModel.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id AS sid, model AS model FROM session WHERE id IN (${placeholders})`,
      )
      .all(...missingModel) as Array<{ sid: string; model: string | null }>;
    for (const r of rows) {
      const entry = bySessionMap.get(r.sid);
      if (entry && typeof r.model === "string" && r.model)
        entry.model = r.model;
    }
  }

  return {
    tool_breakdown,
    steps: stepsRow?.steps ?? 0,
    by_session: [...bySessionMap.values()]
      .filter((s) => s.steps > 0)
      .sort((a, b) => b.steps - a.steps),
    note: STEP_TOKENS_NOTE,
  };
}
