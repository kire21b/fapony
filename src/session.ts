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

export interface PassiveUsageResult {
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens_reasoning: number;
  total_tokens_cache_read: number;
  total_tokens_cache_write: number;
  total_cost: number;
  session_count: number;
  by_model: ModelBreakdown[];
}

const DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

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
): PassiveUsageResult {
  if (!existsSync(DB_PATH)) {
    return EMPTY_RESULT;
  }

  let db: Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });
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

    return {
      total_tokens_input: totalsRow.total_tokens_input,
      total_tokens_output: totalsRow.total_tokens_output,
      total_tokens_reasoning: totalsRow.total_tokens_reasoning,
      total_tokens_cache_read: totalsRow.total_tokens_cache_read,
      total_tokens_cache_write: totalsRow.total_tokens_cache_write,
      total_cost: totalsRow.total_cost,
      session_count: totalsRow.session_count,
      by_model: byModelRows,
    };
  } catch {
    return EMPTY_RESULT;
  } finally {
    db?.close();
  }
}
