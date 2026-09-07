// src/mcp/tools/verdict.ts — verdict_submit tool

import { addEvent, getRun, newRun, openDb, setStatus } from "../../db/index.js";
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

  if (verdict !== "pass" && verdict !== "fail") {
    return errorResult("verdict must be 'pass' or 'fail'");
  }
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

  const eventData = {
    verdict,
    reason_code,
    ...(typeof note === "string" && note ? { note } : {}),
    source: "mcp",
  };

  const eventId = addEvent(db, resolvedRunId, "gate", eventData);
  setStatus(db, resolvedRunId, verdict === "pass" ? "passed" : "fixing");

  return jsonResult({
    stored: true,
    event_id: eventId,
    run_id: resolvedRunId,
    verdict,
    reason_code,
  });
}
