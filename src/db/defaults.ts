import type { Config } from "./types.js";

export const DEFAULT_SPEC_MAX_LINES = 200;
export const DEFAULT_PLAN_MAX_LINES = 200;
export const DEFAULT_SOURCE_MARKER = "^>\\s*\\*\\*Source spec:\\*\\*\\s*(.+)$";
export const DEFAULT_HANDOFF_MARKER = "## HANDOFF";
export const DEFAULT_VERDICT_RE = "^VERDICT:\\s*(pass|fail)\\s*$";
export const DEFAULT_NEXT_PROMPT_MARKER = "## NEXT-PROMPT";
export const DEFAULT_FILE_DONE_MARKER = "## FILE_DONE";
export const DEFAULT_SHIPPED_RE = "^>\\s*✅\\s*\\*\\*.*shipped.*\\*\\*";
export const DEFAULT_SAFETY_DENY = [
  "reset\\s+--hard",
  "clean\\s+-[a-z]*f",
  "checkout\\s+--\\s",
  "git\\s+stash",
];
export const DEFAULT_PLAN_DIR = ".fapony/plan";
export const DEFAULT_SPEC_DIR = ".fapony/spec";
export const DEFAULT_MEMORY_ENTRY = ".fapony/.memory/mem.ts";
export const DEFAULT_DONE_DIR = "done";
export const DEFAULT_LINK_SCAN_DIRS = [
  ".fapony/plan/",
  ".fapony/spec/",
  "docs/",
];
export const DEFAULT_PLAN_EXTENSIONS = [".md"];
export const DEFAULT_ARCHIVE_MSG =
  "chore(plan): archive {file} (shipped {hash})";
export const DEFAULT_INBOUND_WARN_AT = 5;
export const DEFAULT_DIRTY_PREVIEW = 10;
export const DEFAULT_SHORT_SHA = 8;
// Per-role spawn timeout fallbacks (minutes) — used only when neither
// roles.<name>.timeoutMin nor defaults.timeoutMin is set.
export const DEFAULT_ROLE_TIMEOUTS: Record<string, number> = {
  gate: 10,
  planner: 10,
  bigFixer: 20,
  scrutinizeFix: 15,
};

export const DEFAULT_CONFIG: Config = {
  worktrees: {},
  executor: { cmd: ["opencode", "run"], timeoutMin: 45 },
  review: {
    bigDiff: { files: 15, lines: 400 },
    maxRounds: 2,
    gate: ["claude", "-p", "/code-review high"],
    prefilter: null,
  },
  memory: null,
  telemetry: null,
  pricing: null,
  prompts: null,
  spec: null,
  markers: null,
  paths: null,
  safety: null,
  plan: null,
  planmv: null,
  display: null,
  defaults: null,
};
