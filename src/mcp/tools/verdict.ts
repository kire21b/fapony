// src/mcp/tools/verdict.ts — verdict_submit tool

import { getRun, newRun, openDb, patchLastGateEvent } from "../../db/index.js";
import { gateOnce } from "../../gate.js";
import { VERDICT_GRADES, type VerdictGrade } from "../../parse.js";
import {
  errorResult,
  jsonResult,
  REASON_CODES,
  type ReasonCode,
  type ToolResult,
} from "../types.js";

// --- Tool implementation ---

export function toolVerdictSubmit(args: Record<string, unknown>): ToolResult {
  const { run_id, verdict, reason_code, note } = args;

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
    // Auto-create a run entry for external agents
    resolvedRunId = newRun(db, "mcp-external", null, null, "mcp");
  }

  // Route through gateOnce for consistent status/round/memory handling.
  const mcpNote =
    typeof note === "string" && note
      ? `[${reason_code}] ${note}`
      : `[${reason_code}]`;
  const result = gateOnce(resolvedRunId, grade, mcpNote);

  if (result.error) {
    return jsonResult({ stored: false, error: result.error });
  }

  // Patch the gate event with MCP-specific fields (reason_code, source).
  patchLastGateEvent(db, resolvedRunId, { reason_code, source: "mcp" });

  return jsonResult({
    stored: true,
    run_id: resolvedRunId,
    verdict: grade,
    reason_code,
    status: result.status,
  });
}
