// src/planlint.ts — cheap heuristics that catch spec content leaking into
// plan files. Warns only, never blocks a run (same fail-safe stance as
// handoff_missing) — a plan author still ships, they just can't miss it.

import { planMaxLines, sourceSpecRE, type Config } from "./db/index.js";

export interface PlanHygieneWarning {
  kind: "too_long" | "spec_leak";
  detail: string;
}

const SECTION7_START_RE = /^##\s*7\./;
const NEXT_HEADING_RE = /^##\s/;
const SECTION7_LEAK_LINES = 5;

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

export function checkPlanHygiene(planText: string, config?: Config): PlanHygieneWarning[] {
  const warnings: PlanHygieneWarning[] = [];
  const lineCount = planText.split("\n").length;
  const maxLines = planMaxLines(config);

  if (lineCount > maxLines) {
    warnings.push({
      kind: "too_long",
      detail: `plan is ${lineCount} lines (cap ${maxLines}) — likely spec detail pasted in, move it to spec/ and link instead`,
    });
  }

  const sourceMatch = planText.match(sourceSpecRE(config));
  const hasSpec = !!sourceMatch && !/ไม่มี/.test(sourceMatch[1] ?? "");
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
