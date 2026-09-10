// src/mcp/tools/plans.ts — plan_list tool
//
// Answers "what's pending, and what do I know about it" — not a directory
// listing (an agent can `ls` on its own for that). The value is the join:
// filesystem plan files × real run history from `runs`/`events`, so picking
// which plan to work on is informed instead of a coin flip.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Event, openDb, planDir, type Run } from "../../db/index.js";
import { getLastVerdictByPlan, resolveMaxRounds } from "../../stats/index.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";

function titleOf(path: string): string {
  try {
    const text = readFileSync(path, "utf8");
    const m = /^#\s+(.+)$/m.exec(text);
    return m ? m[1].trim() : "(no title)";
  } catch {
    return "(unreadable)";
  }
}

export function toolPlanList(args: Record<string, unknown>): ToolResult {
  const worktree = typeof args.worktree === "string" ? args.worktree : "";
  if (!worktree) return errorResult("worktree is required (absolute path)");

  const dir = join(worktree, planDir());
  const doneDir = join(dir, "done");
  if (!existsSync(dir)) {
    return jsonResult({ pending: [], done: 0, error: `no plan dir at ${dir}` });
  }

  const pendingFiles = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const doneCount = existsSync(doneDir)
    ? readdirSync(doneDir).filter((f) => f.endsWith(".md")).length
    : 0;

  const db = openDb();
  const runs = db.prepare("SELECT * FROM runs ORDER BY id").all() as Run[];
  const events = db
    .prepare("SELECT * FROM events ORDER BY run_id, id")
    .all() as Event[];
  const byPlan = getLastVerdictByPlan(runs, events, resolveMaxRounds());

  const pending = pendingFiles.map((file) => {
    // Runs record whatever plan string the caller passed (often a relative
    // or absolute path) — match by filename suffix, not exact equality.
    const match = byPlan.find((p) => p.plan.endsWith(file));
    return {
      file,
      title: titleOf(join(dir, file)),
      runs: match?.runs ?? 0,
      last: match
        ? match.lastReasonCode
          ? `${match.lastVerdict}(${match.lastReasonCode})`
          : match.lastVerdict
        : "never attempted",
      escalated: match?.escalated ?? false,
    };
  });

  return jsonResult({ pending, done: doneCount });
}
