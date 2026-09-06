// src/run/types.ts — types shared across run modules

import type { RunStatus } from "../db/index.js";
import type { GitFacts, ParsedHandoff } from "../handoff.js";

export interface RunOnceOpts {
  worktreeKey: string;
  planPath: string | null;
  planContent: string | null;
  memId: string | null;
  allowDirty: boolean;
}

export interface RunOnceResult {
  runId: number;
  status: RunStatus;
  facts: GitFacts;
  parsed: ParsedHandoff;
  isBig: boolean;
  error?: string;
}
