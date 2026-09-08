// src/mcp/tools/report.ts — verification_report MCP tool
//
// High-level composition: collects facts + handoff check + evidence +
// run metrics + verdict into a single VerificationReport.
// Calls existing primitives — no duplicate parser/conformance logic.

import { sumSpawnCost } from "../../cost.js";
import { getEvents, getRun, openDb } from "../../db/index.js";
import { parseGateVerdict } from "../../parse.js";
import { collectEvidence } from "../evidence.js";
import type { CheckResult, VerificationReport } from "../primitives.js";
import { computeEvidenceSummary, renderReportText } from "../primitives.js";
import { errorResult, jsonResult, type ToolResult } from "../types.js";
import { toolHandoffCheck } from "./check.js";
import { toolHandoffCollect } from "./collect.js";

// --- Handoff text reader ---

function readHandoffFromEvents(runId: number): string | null {
  const db = openDb();
  try {
    const events = getEvents(db, runId);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind !== "handoff") continue;
      try {
        const parsed = JSON.parse(events[i].data ?? "") as {
          missing?: boolean;
        };
        if (!parsed.missing && events[i].data) {
          // Reconstruct handoff text from the parsed data
          const dataStr = events[i].data as string;
          const d = JSON.parse(dataStr) as Record<string, unknown>;
          const lines = ["## HANDOFF"];
          if (d.claimed) lines.push(`claimed: ${d.claimed}`);
          if (d.commits)
            lines.push(
              `commits: ${Array.isArray(d.commits) ? d.commits.join(" ") : d.commits}`,
            );
          if (d.checks) lines.push(`checks: ${d.checks}`);
          if (d.uncertain && Array.isArray(d.uncertain) && d.uncertain.length)
            lines.push(`uncertain: ${d.uncertain.join("\n")}`);
          if (d.not_done && Array.isArray(d.not_done) && d.not_done.length)
            lines.push(`not_done: ${d.not_done.join("\n")}`);
          return lines.join("\n");
        }
      } catch {
        // skip unparseable events
      }
      break;
    }
    return null;
  } finally {
    db.close();
  }
}

// --- Tool implementation ---

export function toolVerificationReport(
  args: Record<string, unknown>,
): ToolResult {
  const {
    run_id,
    worktree,
    base_sha,
    head_sha,
    handoff: handoffArg,
    evidence_commands,
    format,
  } = args;

  // --- Resolve worktree + run ---
  let resolvedWorktree: string | null = null;
  let resolvedRunId: number | null = null;

  if (typeof run_id === "number" && Number.isInteger(run_id)) {
    const db = openDb();
    try {
      const run = getRun(db, run_id);
      if (!run) {
        return errorResult(`run ${run_id} not found`);
      }
      resolvedRunId = run_id;
      resolvedWorktree = run.worktree;
    } finally {
      db.close();
    }
  } else if (typeof worktree === "string") {
    resolvedWorktree = worktree;
  } else {
    return errorResult("provide run_id or worktree");
  }

  // --- Git facts ---
  let facts: VerificationReport["facts"] = {
    files_changed: 0,
    lines_changed: 0,
    insertions: 0,
    deletions: 0,
    commits: [],
    branch: "",
    git_error: null,
  };

  if (resolvedWorktree) {
    const collectResult = toolHandoffCollect({
      worktree: resolvedWorktree,
      ...(typeof base_sha === "string" ? { base_sha } : {}),
      ...(typeof head_sha === "string" ? { head_sha } : {}),
    });
    const collectData = JSON.parse(collectResult.content[0].text) as {
      facts?: VerificationReport["facts"];
    };
    if (collectData.facts) {
      facts = {
        files_changed: collectData.facts.files_changed ?? 0,
        lines_changed: collectData.facts.lines_changed ?? 0,
        insertions: collectData.facts.insertions ?? 0,
        deletions: collectData.facts.deletions ?? 0,
        commits: collectData.facts.commits ?? [],
        branch: collectData.facts.branch ?? "",
        git_error: collectData.facts.git_error ?? null,
      };
    }
  }

  // --- Handoff checks ---
  let handoffChecks: VerificationReport["handoff_checks"] = null;
  const handoffText =
    typeof handoffArg === "string"
      ? handoffArg
      : resolvedRunId
        ? readHandoffFromEvents(resolvedRunId)
        : null;

  if (handoffText) {
    const checkResult = toolHandoffCheck({
      handoff: handoffText,
      facts,
      uncertain: "none",
      not_done: "none",
      checks: "none",
    });
    const checkData = JSON.parse(checkResult.content[0].text) as {
      checks?: unknown[];
      summary?: {
        total: number;
        passed: number;
        failed: number;
        needs_human_review: boolean;
      };
    };
    if (checkData.checks && checkData.summary) {
      handoffChecks = {
        checks: checkData.checks as CheckResult[],
        summary: checkData.summary,
      };
    }
  }

  // --- Evidence ---
  const agentCmds = Array.isArray(evidence_commands)
    ? evidence_commands.filter((c): c is string => typeof c === "string")
    : undefined;
  const evidence = resolvedWorktree
    ? collectEvidence({ worktree: resolvedWorktree, agentCommands: agentCmds })
    : [];
  const evidence_summary = computeEvidenceSummary(evidence);

  // --- Verdict ---
  let verdict: VerificationReport["verdict"] = null;
  if (resolvedRunId) {
    const db = openDb();
    try {
      const events = getEvents(db, resolvedRunId);
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].kind !== "gate") continue;
        const parsed = parseGateVerdict(events[i].data ?? "");
        if (parsed) {
          verdict = { grade: parsed.verdict, note: parsed.note };
        }
        break;
      }
    } finally {
      db.close();
    }
  }

  // --- Duration + rounds ---
  let duration_ms: number | null = null;
  let rounds = 0;
  if (resolvedRunId) {
    const db = openDb();
    try {
      const run = getRun(db, resolvedRunId);
      if (run) {
        rounds = run.round;
        const t0 = new Date(`${run.created_at.replace(" ", "T")}Z`).getTime();
        const t1 = new Date(`${run.updated_at.replace(" ", "T")}Z`).getTime();
        duration_ms = t1 - t0;
      }
    } finally {
      db.close();
    }
  }

  // --- Cost ---
  let cost: VerificationReport["cost"] = {
    spawns: 0,
    bytes_in: 0,
    bytes_out: 0,
    usd_estimate: null,
  };
  if (resolvedRunId) {
    const db = openDb();
    try {
      const events = getEvents(db, resolvedRunId);
      cost = sumSpawnCost(events);
    } finally {
      db.close();
    }
  }

  // --- Assemble report ---
  const report: VerificationReport = {
    facts,
    handoff_checks: handoffChecks,
    evidence,
    evidence_summary,
    verdict,
    duration_ms,
    rounds,
    cost,
    meta: {
      generated_at: new Date().toISOString(),
      source: "fapony_mcp",
      run_id: resolvedRunId,
    },
  };

  // --- Output ---
  if (format === "json") {
    return jsonResult(report);
  }
  return { content: [{ type: "text", text: renderReportText(report) }] };
}
