// src/report.ts — `fapony report <run-id>` CLI command
//
// Renders a VerificationReport for a completed or in-progress run.
// Uses the same composition logic as the MCP verification_report tool.

import { execSync } from "node:child_process";
import { sumSpawnCost } from "./cost.js";
import { getEvents, getRun, openDb, type Run } from "./db/index.js";
import { collectEvidence } from "./mcp/evidence.js";
import type { VerificationReport } from "./mcp/primitives.js";
import { computeEvidenceSummary, renderReportText } from "./mcp/primitives.js";
import { parseGateVerdict } from "./parse.js";

export function cmdReport(args: string[]): void {
  const runId = parseInt(args[0], 10);
  if (!runId || Number.isNaN(runId)) {
    console.error("usage: fapony report <run-id>");
    process.exit(1);
  }

  const db = openDb();
  let run: Run | null;
  try {
    run = getRun(db, runId);
  } finally {
    db.close();
  }

  if (!run) {
    console.error(`run ${runId} not found`);
    process.exit(1);
  }

  // Git facts
  let facts: VerificationReport["facts"] = {
    files_changed: 0,
    lines_changed: 0,
    insertions: 0,
    deletions: 0,
    commits: [],
    branch: "",
    git_error: null,
  };

  try {
    const stat = execSync(`git diff --stat ${run.base_sha}..HEAD -- .`, {
      cwd: run.worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    const fileMatch = stat.match(/(\d+) files? changed/);
    const insMatch = stat.match(/(\d+) insertions?\(\+\)/);
    const delMatch = stat.match(/(\d+) deletions?\(-\)/);
    const ins = insMatch ? parseInt(insMatch[1], 10) : 0;
    const del = delMatch ? parseInt(delMatch[1], 10) : 0;
    facts = {
      files_changed: fileMatch ? parseInt(fileMatch[1], 10) : 0,
      lines_changed: ins + del,
      insertions: ins,
      deletions: del,
      commits: [],
      branch: "",
      git_error: null,
    };
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && "message" in e
        ? String((e as { message?: string }).message ?? "unknown")
        : "unknown";
    facts.git_error = `git diff failed: ${msg.slice(0, 200)}`;
  }

  try {
    const log = execSync(`git log --oneline ${run.base_sha}..HEAD`, {
      cwd: run.worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    facts.commits = log
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l: string) => l.split(" ")[0]);
  } catch {
    // non-fatal
  }

  try {
    facts.branch = execSync("git branch --show-current", {
      cwd: run.worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
  } catch {
    // non-fatal
  }

  // Evidence
  const evidence = collectEvidence({ worktree: run.worktree });
  const evidence_summary = computeEvidenceSummary(evidence);

  // Verdict
  let verdict: VerificationReport["verdict"] = null;
  const db2 = openDb();
  try {
    const events = getEvents(db2, runId);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind !== "gate") continue;
      const parsed = parseGateVerdict(events[i].data ?? "");
      if (parsed) verdict = { grade: parsed.verdict, note: parsed.note };
      break;
    }
  } finally {
    db2.close();
  }

  // Duration
  const t0 = new Date(`${run.created_at.replace(" ", "T")}Z`).getTime();
  const t1 = new Date(`${run.updated_at.replace(" ", "T")}Z`).getTime();

  // Cost
  const db3 = openDb();
  let cost: VerificationReport["cost"];
  try {
    const events = getEvents(db3, runId);
    cost = sumSpawnCost(events);
  } finally {
    db3.close();
  }

  const report: VerificationReport = {
    facts,
    handoff_checks: null,
    evidence,
    evidence_summary,
    verdict,
    duration_ms: t1 - t0,
    rounds: run.round,
    cost,
    meta: {
      generated_at: new Date().toISOString(),
      source: "fapony_cli",
      run_id: runId,
    },
  };

  console.log(renderReportText(report));
}
