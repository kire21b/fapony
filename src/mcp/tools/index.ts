// src/mcp/tools/index.ts — barrel + TOOLS array

import { VERDICT_GRADES } from "../../parse.js";
import { REASON_CODES } from "../types.js";

export { extractMultiField, toolHandoffCheck } from "./check.js";
export { toolHandoffCollect } from "./collect.js";
export { toolFaponyStats } from "./stats.js";
export { toolVerdictSubmit } from "./verdict.js";

// --- Tool definitions ---

export const TOOLS = [
  {
    name: "handoff_collect",
    description:
      "Collect machine facts from git: diff stat, commits, branch. " +
      "Returns verified facts (fapony runs git directly, not trusting agent claims). " +
      "If base_sha/head_sha are omitted, auto-detects from recent commits (HEAD~1..HEAD).",
    inputSchema: {
      type: "object" as const,
      properties: {
        base_sha: {
          type: "string",
          description:
            "Git base SHA for diff range. Defaults to HEAD~1 if omitted.",
        },
        head_sha: {
          type: "string",
          description:
            "Git head SHA for diff range. Defaults to HEAD if omitted.",
        },
        worktree: {
          type: "string",
          description: "Absolute path to git worktree",
        },
      },
      required: ["worktree"],
    },
  },
  {
    name: "handoff_check",
    description:
      "Verify handoff conformance: check that executor's handoff block has " +
      "required fields, no unresolved uncertainty, and facts cross-reference. " +
      "Set auto_generate to true to auto-fill claimed/commits from git facts, " +
      "but uncertain/not_done/checks must still come from the agent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        handoff: {
          type: "string",
          description:
            "Raw handoff text (must contain ## HANDOFF block). " +
            "If auto_generate is true, this is optional and claimed/commits will be filled from facts.",
        },
        facts: {
          type: "object",
          description:
            "Optional facts from handoff_collect for cross-reference",
        },
        auto_generate: {
          type: "boolean",
          description:
            "If true, auto-fill claimed/commits from git facts. " +
            "uncertain/not_done/checks must still be provided by the agent.",
        },
        uncertain: {
          type: "string",
          description:
            "Agent-reported uncertainty. Use 'none' if no uncertainty. " +
            "Required when auto_generate is true.",
        },
        not_done: {
          type: "string",
          description:
            "Agent-reported incomplete items. Use 'none' if nothing pending. " +
            "Required when auto_generate is true.",
        },
        checks: {
          type: "string",
          description:
            "Agent-reported checks performed. " +
            "Required when auto_generate is true.",
        },
        plan_ref: {
          type: "string",
          description: "Optional plan file reference",
        },
      },
      required: [],
    },
  },
  {
    name: "verdict_submit",
    description:
      "Record a verdict with reason code into the event log. " +
      "Creates a new run entry if run_id is not provided.",
    inputSchema: {
      type: "object" as const,
      properties: {
        run_id: {
          type: "number",
          description:
            "Optional run ID from fapony. If omitted, a new run is created automatically.",
        },
        verdict: {
          type: "string",
          enum: [...VERDICT_GRADES],
          description: "Verdict grade",
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
      required: ["verdict", "reason_code"],
    },
  },
  {
    name: "fapony_stats",
    description:
      "Query accumulated run statistics: pass/stall rates, cost, quality scores, " +
      "breakdown by model/grade/worktree. Returns StatsData shape.",
    inputSchema: {
      type: "object" as const,
      properties: {
        json: {
          type: "boolean",
          description:
            "If true, return raw JSON StatsData. If false (default), return human-readable text.",
        },
      },
      required: [],
    },
  },
];
