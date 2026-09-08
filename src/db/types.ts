export type RunStatus =
  | "running"
  | "awaiting_review"
  | "fixing"
  | "passed"
  | "stopped"
  | "stalled";

export interface Run {
  id: number;
  worktree: string;
  plan: string | null;
  mem_id: string | null;
  status: RunStatus;
  base_sha: string;
  round: number;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  run_id: number;
  ts: string;
  kind: string;
  data: string | null;
}

export interface Config {
  worktrees: Record<string, string>;
  executor: { cmd: string[]; timeoutMin: number };
  roles?: {
    [name: string]: { cmd: string[]; model?: string; timeoutMin?: number };
  };
  review: {
    bigDiff: { files: number; lines: number };
    maxRounds: number;
    gate: string[];
    prefilter: null;
    autoLoop?: boolean;
  };
  memory: {
    claim: string[];
    close: string[];
    add: string[];
    kickoff?: string[];
  } | null;
  // Optional static pricing per role (USD per 1k tokens, input/output split).
  // Omit or null = byte measurement stays on, USD estimate stays off.
  pricing?: Record<string, { inputPer1k: number; outputPer1k: number }> | null;
  // opt-in only — omit or leave null to keep everything local. See TELEMETRY.md
  // for the exact payload shape (KPI numbers + event kind/timestamp, no
  // plan/commit/gate-note content, ever).
  telemetry?: {
    enabled: boolean;
    endpoint: string;
    /** Self-reported metadata — advisory, not machine-observed. */
    metadata?: {
      task_category?: string;
      stack?: string;
      notes?: string;
    };
  } | null;
  // --- Flexible paths / markers / limits (all optional, defaults = old hardcodes) ---
  prompts?: {
    executor?: string | null;
    gate?: string | null;
    planner?: string | null;
    bigFixer?: string | null;
    scrutinizeFix?: string | null;
  } | null;
  spec?: {
    maxLines?: number;
    // regex source (no slashes/flags — always compiled with "m") matching the
    // plan header line; capture group 1 = raw spec ref.
    sourceMarker?: string;
  } | null;
  markers?: {
    handoff?: string;
    // regex sources for the gate verdict line; group 1 = pass-excellent|pass-good|pass-adequate|pass|fail|uncertain.
    verdict?: string;
    nextPrompt?: string;
    fileDone?: string;
    // regex source (no slashes/flags) for the shipped header; default matches
    // "> ✅ **shipped** (<hash>)".
    shipped?: string;
  } | null;
  paths?: {
    // state dir override (default: $XDG_CONFIG_HOME/fapony or ~/.config/fapony).
    // $FAPONY_STATE_DIR env wins over this when set.
    stateDir?: string;
    // plan/spec/memory layout inside each worktree (relative to worktree root).
    planDir?: string;
    specDir?: string;
    memoryEntry?: string;
    // archive subdir name for plan-mv (e.g. "done").
    doneDir?: string;
    // dirs scanned for inbound links by plan-mv (relative to repo root).
    linkScanDirs?: string[];
  } | null;
  safety?: {
    // regex sources tested against the joined argv; default = the 4 git patterns.
    deny?: string[];
  } | null;
  plan?: {
    extensions?: string[];
    // hygiene check: warn (never block) when a plan file exceeds this many
    // lines, or when section 7 balloons despite a linked Source spec.
    maxLines?: number;
  } | null;
  planmv?: {
    // "chore(plan): archive ..." commit template; vars {file} {hash}.
    archiveMsg?: string;
    inboundWarnAt?: number;
  } | null;
  display?: {
    dirtyPreview?: number;
    shortSha?: number;
  } | null;
  defaults?: {
    // fallback role timeout (minutes) when roles.<name>.timeoutMin is unset.
    timeoutMin?: number;
  } | null;
  // --- Resilience (retry + backoff + interrupt) ---
  // Omit or null = old behavior (fail → stalled immediately, no retry).
  resilience?: {
    retry?: {
      maxAttempts?: number;
      limitBaseMs?: number;
      crashBaseMs?: number;
      maxMs?: number;
    } | null;
    patterns?: {
      limit?: string[];
      auth?: string[];
    } | null;
  } | null;
}

export interface RolePricing {
  inputPer1k: number;
  outputPer1k: number;
}
