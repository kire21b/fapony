// src/session/helpers.ts — shared patterns for session usage providers
//
// Both OpenCode and ZCode (and future SQLite-backed providers) share:
// 1. WHERE-clause building with worktree/since/until filters
// 2. Detail aggregation: tool + step rows → UsageDetail shape
//
// The join column for worktree differs per provider (OpenCode: pr.worktree,
// ZCode: s.directory) — callers supply the column name.

import type { Database } from "bun:sqlite";
import type { SessionDetail, UsageDetail } from "./types.js";
import { STEP_TOKENS_NOTE } from "./types.js";

// ─── WHERE clause builder ──────────────────────────────────────────────

export interface WhereClause {
  /** SQL fragment: either `AND ...` or empty string. */
  clause: string;
  /** Bound parameters in order. */
  params: (string | number)[];
}

/**
 * Build a WHERE / AND filter clause for (worktree, since, until).
 *
 * @param worktreeCol - Column to match the worktree path (e.g. `pr.worktree` or `s.directory`).
 * @param worktree - Optional worktree path filter.
 * @param since - Optional lower bound for `s.time_created`.
 * @param until - Optional upper bound for `s.time_created`.
 * @param prefix - `"WHERE"` when this is the only filter block, `"AND"` when appended to existing WHERE.
 */
export function buildWhereClause(
  worktreeCol: string,
  worktree?: string,
  since?: number,
  until?: number,
  prefix: "WHERE" | "AND" = "AND",
): WhereClause {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (worktree) {
    conds.push(`${worktreeCol} = ?`);
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
    clause: conds.length > 0 ? `${prefix} ${conds.join(" AND ")}` : "",
    params,
  };
}

// ─── Detail aggregation ────────────────────────────────────────────────

export interface DetailToolRow {
  tool: string | null;
  c: number;
}

export interface DetailStepRow {
  sid: string;
  model: string | null;
  steps: number;
}

export interface DetailPerSessionToolRow {
  sid: string;
  tool: string | null;
  c: number;
}

/**
 * Aggregate tool + step query results into a UsageDetail.
 *
 * This is the shared logic between OpenCode's `readUsageDetail()` and
 * ZCode's `readZcodeUsageDetail()`. Both query:
 * - tool rows (tool name + count)
 * - step rows (session id + model + step count)
 * - per-session tool rows (session id + tool + count)
 * then merge into the same UsageDetail shape via a Map.
 */
export function aggregateDetail(
  toolRows: DetailToolRow[],
  stepsRow: { steps: number },
  perSessionSteps: DetailStepRow[],
  perSessionTools: DetailPerSessionToolRow[],
  fallbackModelLookup?: Array<{ sid: string; model: string | null }>,
): UsageDetail {
  const tool_breakdown: Record<string, number> = {};
  for (const r of toolRows) {
    const name = typeof r.tool === "string" && r.tool ? r.tool : "(unknown)";
    tool_breakdown[name] = r.c;
  }

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
      entry = { session_id: r.sid, model: "(unknown)", steps: 0, tools: {} };
      bySessionMap.set(r.sid, entry);
    }
    const name = typeof r.tool === "string" && r.tool ? r.tool : "(unknown)";
    entry.tools[name] = r.c;
  }

  // Backfill model for sessions that have tools but no step-finish rows.
  if (fallbackModelLookup) {
    for (const r of fallbackModelLookup) {
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

// ─── SQLite detail reader ──────────────────────────────────────────────

/**
 * SQL join fragment for the session→project link.
 * OpenCode needs `JOIN project pr ON pr.id = s.project_id`.
 * ZCode doesn't (worktree is on the session table directly).
 */
function joinClause(needsProject: boolean): string {
  return needsProject ? "JOIN project pr ON pr.id = s.project_id" : "";
}

/**
 * Run detail queries against a SQLite DB and return UsageDetail.
 *
 * Providers supply the worktree column name. If it starts with `pr.`,
 * the project join is included automatically. The model column for
 * per-session queries is configurable (OpenCode: `s.model`, ZCode: `s.directory`).
 *
 * @param db - Open SQLite connection (readonly).
 * @param worktreeCol - e.g. `pr.worktree` (OpenCode) or `s.directory` (ZCode).
 * @param modelCol - Column for the model in per-session queries (e.g. `s.model` or `s.directory`).
 * @param worktree - Optional worktree path filter.
 * @param since - Optional lower bound.
 * @param until - Optional upper bound.
 */
export function readDetailFromDb(
  db: Database,
  worktreeCol: string,
  modelCol: string,
  worktree?: string,
  since?: number,
  until?: number,
): UsageDetail {
  const needsProject = worktreeCol.startsWith("pr.");
  const join = joinClause(needsProject);
  const filter = buildWhereClause(worktreeCol, worktree, since, until);

  const toolRows = db
    .prepare(
      `
      SELECT json_extract(p.data, '$.tool') AS tool, COUNT(*) AS c
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'tool'
      ${filter.clause}
      GROUP BY tool
      ORDER BY c DESC
    `,
    )
    .all(...filter.params) as DetailToolRow[];

  const stepsRow = db
    .prepare(
      `
      SELECT COUNT(*) AS steps
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'step-finish'
      ${filter.clause}
    `,
    )
    .get(...filter.params) as { steps: number };

  const perSessionSteps = db
    .prepare(
      `
      SELECT p.session_id AS sid, ${modelCol} AS model, COUNT(*) AS steps
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'step-finish'
      ${filter.clause}
      GROUP BY sid
    `,
    )
    .all(...filter.params) as DetailStepRow[];

  const perSessionTools = db
    .prepare(
      `
      SELECT p.session_id AS sid, json_extract(p.data, '$.tool') AS tool, COUNT(*) AS c
      FROM part p
      JOIN session s ON s.id = p.session_id
      ${join}
      WHERE json_extract(p.data, '$.type') = 'tool'
      ${filter.clause}
      GROUP BY sid, tool
    `,
    )
    .all(...filter.params) as DetailPerSessionToolRow[];

  // Backfill model for sessions with tools but no step-finish rows.
  let fallbackModelLookup:
    | Array<{ sid: string; model: string | null }>
    | undefined;
  if (needsProject) {
    const toolSids = [...new Set(perSessionTools.map((r) => r.sid))];
    const stepSids = new Set(perSessionSteps.map((r) => r.sid));
    const missingModel = toolSids.filter((sid) => !stepSids.has(sid));
    if (missingModel.length > 0) {
      const placeholders = missingModel.map(() => "?").join(",");
      fallbackModelLookup = db
        .prepare(
          `SELECT id AS sid, model AS model FROM session WHERE id IN (${placeholders})`,
        )
        .all(...missingModel) as Array<{ sid: string; model: string | null }>;
    }
  }

  return aggregateDetail(
    toolRows,
    stepsRow,
    perSessionSteps,
    perSessionTools,
    fallbackModelLookup,
  );
}
