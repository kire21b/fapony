// src/mcp.ts — MCP server (stdio JSON-RPC) for handcheck protocol.
// 3 tools: handoff_collect → handoff_check → verdict_submit
// Zero new dependencies — bun:sqlite + node:child_process + node:fs

import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { addEvent, getRun, openDb } from "./db/index.js";
import { assertSafe } from "./safety.js";

// --- ReasonCode enum (locked in step 0, append-only) ---

export const REASON_CODES = [
  "missing_test",
  "scope_mismatch",
  "unsafe_command",
  "spec_gap",
  "other",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

// --- MCP protocol constants ---

const MCP_PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "fapony-handcheck";
const SERVER_VERSION = "0.1.0";

// --- Tool definitions ---

export const TOOLS = [
  {
    name: "handoff_collect",
    description:
      "Collect machine facts from git: diff stat, commits, branch. " +
      "Returns verified facts (fapony runs git directly, not trusting agent claims).",
    inputSchema: {
      type: "object" as const,
      properties: {
        base_sha: {
          type: "string",
          description: "Git base SHA for diff range",
        },
        head_sha: {
          type: "string",
          description: "Git head SHA for diff range",
        },
        worktree: {
          type: "string",
          description: "Absolute path to git worktree",
        },
      },
      required: ["base_sha", "head_sha", "worktree"],
    },
  },
  {
    name: "handoff_check",
    description:
      "Verify handoff conformance: check that executor's handoff block has " +
      "required fields, no unresolved uncertainty, and facts cross-reference.",
    inputSchema: {
      type: "object" as const,
      properties: {
        handoff: {
          type: "string",
          description: "Raw handoff text (must contain ## HANDOFF block)",
        },
        facts: {
          type: "object",
          description:
            "Optional facts from handoff_collect for cross-reference",
        },
        plan_ref: {
          type: "string",
          description: "Optional plan file reference",
        },
      },
      required: ["handoff"],
    },
  },
  {
    name: "verdict_submit",
    description:
      "Record a pass/fail verdict with reason code into the run's event log. " +
      "Requires an existing run_id from fapony.",
    inputSchema: {
      type: "object" as const,
      properties: {
        run_id: {
          type: "number",
          description: "Existing run ID from fapony",
        },
        verdict: {
          type: "string",
          enum: ["pass", "fail"],
          description: "Verdict: pass or fail",
        },
        reason_code: {
          type: "string",
          enum: [...REASON_CODES],
          description: "Standardized failure reason code",
        },
        note: {
          type: "string",
          description: "Optional note (required when reason_code = 'other')",
        },
      },
      required: ["run_id", "verdict", "reason_code"],
    },
  },
];

// --- Tool implementations ---

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function parseToolResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text);
}

function execGitSafe(
  cmd: string,
  cwd: string,
): { ok: boolean; output: string; error?: string } {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    return { ok: true, output: output.trim() };
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && ("stderr" in e || "message" in e)
        ? String(
            (e as { stderr?: string; message?: string }).stderr ??
              (e as { message?: string }).message ??
              "unknown",
          )
        : "unknown";
    return { ok: false, output: "", error: msg.trim() };
  }
}

export function toolHandoffCollect(args: Record<string, unknown>): ToolResult {
  const { base_sha, head_sha, worktree } = args;

  if (
    typeof base_sha !== "string" ||
    typeof head_sha !== "string" ||
    typeof worktree !== "string"
  ) {
    return errorResult("base_sha, head_sha, and worktree are required strings");
  }

  // Diff stat
  let files_changed = 0;
  let lines_changed = 0;
  let insertions = 0;
  let deletions = 0;
  let gitError: string | undefined;

  const diffResult = execGitSafe(
    `git diff --stat ${base_sha}..${head_sha} -- .`,
    worktree,
  );

  if (diffResult.ok) {
    const fileMatch = diffResult.output.match(/(\d+) files? changed/);
    files_changed = fileMatch ? parseInt(fileMatch[1], 10) : 0;
    const insMatch = diffResult.output.match(/(\d+) insertions?\(\+\)/);
    const delMatch = diffResult.output.match(/(\d+) deletions?\(-\)/);
    insertions = insMatch ? parseInt(insMatch[1], 10) : 0;
    deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
    lines_changed = insertions + deletions;
  } else {
    gitError = `git diff failed: ${diffResult.error}`;
  }

  // Commits
  const logResult = execGitSafe(
    `git log --oneline ${base_sha}..${head_sha}`,
    worktree,
  );
  const commits = logResult.ok
    ? logResult.output
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" ")[0])
    : [];

  // Branch
  const branchResult = execGitSafe("git branch --show-current", worktree);
  const branch = branchResult.ok ? branchResult.output : "";

  // Safety check — run assertSafe on diff content to detect dangerous patterns
  const safety_violations: string[] = [];
  try {
    const diffFull = execGitSafe(
      `git diff ${base_sha}..${head_sha} -- .`,
      worktree,
    );
    if (diffFull.ok) {
      assertSafe(["git", diffFull.output]);
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      safety_violations.push(e.message);
    }
  }

  // Check file types
  const nameResult = execGitSafe(
    `git diff --name-only ${base_sha}..${head_sha}`,
    worktree,
  );
  const names = nameResult.ok
    ? nameResult.output.split("\n").filter(Boolean)
    : [];
  const has_test_changes = names.some((n) =>
    /test|spec|__tests__|\.test\.|\.spec\./i.test(n),
  );
  const has_docs_changes = names.some((n) => /\.md$/i.test(n));

  return jsonResult({
    facts: {
      files_changed,
      lines_changed,
      insertions,
      deletions,
      commits,
      branch,
      git_error: gitError ?? null,
    },
    checks: {
      has_test_changes,
      has_docs_changes,
      safety_violations,
      dangerous_patterns: [],
    },
    provenance: {
      verified: true,
      source: "git_cli",
    },
  });
}

interface CheckResult {
  name: string;
  pass: boolean;
  note: string;
}

export function extractMultiField(text: string, field: string): string[] {
  const regex = new RegExp(`${field}:\\s*(.+)`, "i");
  const match = text.match(regex);
  if (!match) return [];

  const firstLine = match[1].trim();
  if (!firstLine || firstLine === "none") return [];

  const result = [firstLine];
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim().startsWith(`${field}:`));

  const FAPONY_FIELDS = [
    "claimed",
    "commits",
    "checks",
    "uncertain",
    "not_done",
  ];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) break; // empty line ends the field
    if (FAPONY_FIELDS.some((f) => line.startsWith(`${f}:`))) break; // new field
    result.push(line);
  }

  return result;
}

export function toolHandoffCheck(args: Record<string, unknown>): ToolResult {
  const { handoff, facts } = args;

  if (typeof handoff !== "string") {
    return errorResult("handoff is required as a string");
  }

  const checks: CheckResult[] = [];

  // 1. has_handoff_block
  const hasBlock = handoff.includes("## HANDOFF");
  checks.push({
    name: "has_handoff_block",
    pass: hasBlock,
    note: hasBlock ? "" : "no ## HANDOFF block found",
  });

  if (!hasBlock) {
    // Can't check the rest without a block
    return jsonResult({
      checks,
      summary: { total: 1, passed: 0, failed: 1, needs_human_review: true },
    });
  }

  // Extract claimed
  const claimedMatch = handoff.match(/claimed:\s*(.+)/i);
  const claimed = claimedMatch?.[1]?.trim() ?? "";

  // Extract commits
  const commitsMatch = handoff.match(/commits:\s*(.+)/i);
  const commitsStr = commitsMatch?.[1]?.trim() ?? "";
  const handoffCommits =
    commitsStr && commitsStr !== "none"
      ? commitsStr.split(/\s+/).filter(Boolean)
      : [];

  // Extract checks
  const checksMatch = handoff.match(/checks:\s*(.+)/i);
  const checksField = checksMatch?.[1]?.trim() ?? "";

  // Extract uncertain (multi-line)
  const uncertainLines = extractMultiField(handoff, "uncertain");
  const notDoneLines = extractMultiField(handoff, "not_done");

  // 2. claimed_matches_commits
  if (claimed && claimed !== "none") {
    const claimedInCommits = handoffCommits.some((c) => claimed.startsWith(c));
    checks.push({
      name: "claimed_matches_commits",
      pass: claimedInCommits,
      note: claimedInCommits
        ? `claimed commit ${claimed} found in handoff commits`
        : `claimed commit ${claimed} not found in handoff commits`,
    });
  } else {
    checks.push({
      name: "claimed_matches_commits",
      pass: true,
      note: "no claimed commit to verify",
    });
  }

  // 3. uncertain_not_empty
  const hasUncertain = uncertainLines.length > 0;
  checks.push({
    name: "uncertain_not_empty",
    pass: !hasUncertain,
    note: hasUncertain
      ? `executor flagged uncertainty: ${uncertainLines.join("; ")}`
      : "",
  });

  // 4. not_done_not_empty
  const hasNotDone = notDoneLines.length > 0;
  checks.push({
    name: "not_done_not_empty",
    pass: !hasNotDone,
    note: hasNotDone
      ? `executor reported incomplete: ${notDoneLines.join("; ")}`
      : "",
  });

  // 5. checks_declared
  const hasChecks = checksField.length > 0 && checksField !== "none";
  checks.push({
    name: "checks_declared",
    pass: hasChecks,
    note: hasChecks ? "checks field present" : "no checks field in handoff",
  });

  // 6. facts_cross_referenced
  if (facts && typeof facts === "object") {
    const f = facts as Record<string, unknown>;
    const factCommits = Array.isArray(f.commits) ? (f.commits as string[]) : [];
    if (factCommits.length > 0 && handoffCommits.length > 0) {
      const matchCount = handoffCommits.filter((hc) =>
        factCommits.some((fc) => fc.startsWith(hc) || hc.startsWith(fc)),
      ).length;
      const allMatch = matchCount === handoffCommits.length;
      checks.push({
        name: "facts_cross_referenced",
        pass: allMatch,
        note: `${matchCount}/${handoffCommits.length} commits in handoff match git facts`,
      });
    } else {
      checks.push({
        name: "facts_cross_referenced",
        pass: true,
        note: "no commits to cross-reference",
      });
    }
  } else {
    checks.push({
      name: "facts_cross_referenced",
      pass: false,
      note: "no facts provided for cross-reference",
    });
  }

  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;

  return jsonResult({
    checks,
    summary: {
      total: checks.length,
      passed,
      failed,
      needs_human_review: failed > 0,
    },
  });
}

export function toolVerdictSubmit(args: Record<string, unknown>): ToolResult {
  const { run_id, verdict, reason_code, note } = args;

  if (typeof run_id !== "number" || !Number.isInteger(run_id)) {
    return errorResult("run_id must be an integer");
  }
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
  const run = getRun(db, run_id);
  if (!run) {
    return jsonResult({ stored: false, error: "run not found" });
  }

  const eventData = {
    verdict,
    reason_code,
    ...(typeof note === "string" && note ? { note } : {}),
    source: "mcp",
  };

  const eventId = addEvent(db, run_id, "gate", eventData);

  return jsonResult({
    stored: true,
    event_id: eventId,
    run_id,
    verdict,
    reason_code,
  });
}

// --- JSON-RPC dispatch ---

export function dispatch(
  method: string,
  params: unknown,
): object | ToolResult | null {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    case "notifications/initialized":
      return null; // no response needed
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return toolVerdictSubmit_call(
        params as { name: string; arguments?: Record<string, unknown> },
      );
    default:
      return {
        code: -32601,
        message: `method not found: ${method}`,
      };
  }
}

function toolVerdictSubmit_call(params: {
  name: string;
  arguments?: Record<string, unknown>;
}): ToolResult {
  const args = params.arguments ?? {};
  switch (params.name) {
    case "handoff_collect":
      return toolHandoffCollect(args);
    case "handoff_check":
      return toolHandoffCheck(args);
    case "verdict_submit":
      return toolVerdictSubmit(args);
    default:
      return errorResult(`unknown tool: ${params.name}`);
  }
}

// --- Entry point ---

export function cmdMcp(): void {
  const rl = createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: { id?: number; method: string; params?: unknown };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Invalid JSON — send error
      const resp = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(`${JSON.stringify(resp)}\n`);
      return;
    }

    const result = dispatch(msg.method, msg.params ?? {});

    // notifications don't get a response
    if (result === null) return;

    const resp: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: msg.id ?? null,
    };

    if (
      result &&
      typeof result === "object" &&
      "content" in result &&
      "isError" in result
    ) {
      // Tool result
      resp.result = result;
    } else if (
      result &&
      typeof result === "object" &&
      "code" in result &&
      "message" in result
    ) {
      // Error response
      resp.error = result;
    } else {
      // Normal result
      resp.result = result;
    }

    process.stdout.write(`${JSON.stringify(resp)}\n`);
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
