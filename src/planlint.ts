// src/planlint.ts — cheap heuristics that catch spec content leaking into
// plan files and spec files with wrong names. Warns only, never blocks a run
// (same fail-safe stance as handoff_missing) — a plan author still ships,
// they just can't miss it.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type Config,
  planMaxLines,
  sourceSpecRE,
  specDir,
} from "./db/index.js";

export interface PlanHygieneWarning {
  kind: "too_long" | "spec_leak";
  detail: string;
}

const SECTION7_START_RE = /^##\s*7(?:[\s.\-:—]|$)/;
const NEXT_HEADING_RE = /^##\s/;
const SECTION7_LEAK_LINES = 5;
// "No spec" sentinel in any authoring language — anything else that looks
// like a value counts as linked. A bare "none"/"n/a" must not warn spec_leak.
const NO_SPEC_RE = /ไม่มี|\bnone\b|\bn\/a\b|\bno spec\b|^\s*(—|–|-)\s*$/i;

/** Lines between the "## 7." heading and the next "## " heading (or EOF). */
function section7Lines(planText: string): string[] {
  const lines = planText.split("\n");
  const start = lines.findIndex((l) => SECTION7_START_RE.test(l));
  if (start === -1) return [];
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (NEXT_HEADING_RE.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body;
}

export function checkPlanHygiene(
  planText: string,
  config?: Config,
): PlanHygieneWarning[] {
  const warnings: PlanHygieneWarning[] = [];
  const lines = planText.split("\n");
  // A trailing newline is a terminator, not an extra line.
  const lineCount =
    lines.length - (planText.endsWith("\n") && lines.length > 0 ? 1 : 0);
  const maxLines = planMaxLines(config);

  if (lineCount > maxLines) {
    warnings.push({
      kind: "too_long",
      detail: `plan is ${lineCount} lines (cap ${maxLines}) — likely spec detail pasted in, move it to spec/ and link instead`,
    });
  }

  const sourceMatch = planText.match(sourceSpecRE(config));
  const hasSpec = !!sourceMatch && !NO_SPEC_RE.test(sourceMatch[1] ?? "");
  if (hasSpec) {
    const nonEmpty = section7Lines(planText).filter((l) => l.trim()).length;
    if (nonEmpty > SECTION7_LEAK_LINES) {
      warnings.push({
        kind: "spec_leak",
        detail: `section 7 (Examples) has ${nonEmpty} lines but a Source spec is already linked — link into the spec instead of pasting it`,
      });
    }
  }

  return warnings;
}

// --- spec name hygiene ---

export interface SpecHygieneWarning {
  kind: "bad_name";
  file: string;
  detail: string;
}

const SPEC_NAME_RE = /^SPEC-.+\.md$/;

/**
 * Scan spec dir for .md files that don't match `SPEC-<feature>.md`.
 * Returns warnings only — never blocks a run.
 */
export function checkSpecHygiene(
  worktree: string,
  config?: Config,
): SpecHygieneWarning[] {
  const warnings: SpecHygieneWarning[] = [];
  const dir = join(worktree, specDir(config));
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    // spec dir doesn't exist or unreadable — nothing to check
    return warnings;
  }
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    if (!SPEC_NAME_RE.test(f)) {
      warnings.push({
        kind: "bad_name",
        file: f,
        detail: `spec file "${f}" should be "SPEC-<feature>.md" — rename to match convention`,
      });
    }
  }
  return warnings;
}
