// src/mcp/tools/verdict.ts — verdict_submit tool

import {
  findOpenRun,
  getRun,
  newRun,
  openDb,
  patchLastGateEvent,
} from "../../db/index.js";
import { gateOnce } from "../../gate.js";
import { VERDICT_GRADES, type VerdictGrade } from "../../parse.js";
import {
  errorResult,
  jsonResult,
  REASON_CODES,
  type ReasonCode,
  type ToolResult,
} from "../types.js";
import { resolveWorktreeArg } from "../worktree.js";

// --- Tool implementation ---

export function toolVerdictSubmit(args: Record<string, unknown>): ToolResult {
  const { run_id, verdict, reason_code, note, worktree, plan, session_id } =
    args;

  if (typeof verdict !== "string" || !VERDICT_GRADES.has(verdict)) {
    return errorResult(
      `verdict must be one of: ${[...VERDICT_GRADES].join(", ")}`,
    );
  }
  const grade = verdict as VerdictGrade;
  if (!REASON_CODES.includes(reason_code as ReasonCode)) {
    return errorResult(
      `reason_code must be one of: ${REASON_CODES.join(", ")}`,
    );
  }
  if (reason_code === "other" && (!note || typeof note !== "string")) {
    return errorResult("reason_code 'other' requires a note");
  }

  const db = openDb();

  // Resolve or create run_id
  let resolvedRunId: number;
  if (typeof run_id === "number" && Number.isInteger(run_id)) {
    const run = getRun(db, run_id);
    if (!run) {
      return jsonResult({ stored: false, error: "run not found" });
    }
    resolvedRunId = run_id;
  } else {
    // Bind to the latest still-open run for the same worktree+plan so a
    // round-2+ verdict lands on the original row (round keeps counting and
    // review.maxRounds can actually trigger). Only when no open run matches
    // is a fresh row created. plan=null never matches — bare-diff reviews
    // always open a new run rather than guessing which work they belong to.
    const resolvedWorktree =
      typeof worktree === "string" && worktree
        ? resolveWorktreeArg(worktree)
        : "mcp-external";
    const resolvedPlan = typeof plan === "string" && plan ? plan : null;
    const open =
      resolvedPlan === null
        ? null
        : findOpenRun(db, resolvedWorktree, resolvedPlan);
    if (open) {
      resolvedRunId = open.id;
    } else {
      // worktree/plan let callers (e.g. move-to-done) attribute the verdict
      // so byReasonCode/bestPassing aggregate correctly instead of collapsing
      // into "mcp-external".
      resolvedRunId = newRun(db, resolvedWorktree, resolvedPlan, null, "mcp");
    }
  }

  // Route through gateOnce for consistent status/round/memory handling.
  const mcpNote =
    typeof note === "string" && note
      ? `[${reason_code}] ${note}`
      : `[${reason_code}]`;
  const result = gateOnce(resolvedRunId, grade, mcpNote);

  if (result.error) {
    return jsonResult({
      stored: false,
      error: result.error,
      run_id: resolvedRunId,
      status: result.status,
      round: result.round,
    });
  }

  // Patch the gate event with MCP-specific fields (reason_code, source).
  // session_id lets gates.ts resolve model from client session logs when the
  // window has no spawn events (the old execute→review loop that wrote spawns
  // is gone). Optional — agents that can't expose it just omit it.
  const patch: Record<string, unknown> = { reason_code, source: "mcp" };
  if (typeof session_id === "string" && session_id) {
    patch.session_id = session_id;
  }
  patchLastGateEvent(db, resolvedRunId, patch);

  return jsonResult({
    stored: true,
    run_id: resolvedRunId,
    verdict: grade,
    reason_code,
    status: result.status,
    round: result.round,
  });
}
