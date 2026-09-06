// src/run/plan.ts — plan content resolution, hygiene check, spec injection

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, specMaxLines } from "../db/index.js";
import { checkPlanHygiene } from "../planlint.js";
import { parseSourceSpec, readSpec } from "./spec.js";

const NO_PLAN = "(no plan provided)";
const NOT_FOUND_PREFIX = "(plan file not found";

function isNoPlan(plan: string | null | undefined): boolean {
  return !plan || plan === NO_PLAN || plan.startsWith(NOT_FOUND_PREFIX);
}

export interface PlanResult {
  planContent: string;
  specContent: string | null;
}

/** Resolve plan + spec for a run. Warns hygiene but never blocks. */
export function resolvePlan(
  worktree: string,
  planPath: string | null,
  planContentOverride: string | null,
  config: Config,
): PlanResult {
  let planContent = planContentOverride;
  if (!planContent && planPath) {
    try {
      planContent = readFileSync(join(worktree, planPath), "utf-8");
    } catch {
      planContent = `(plan file not found: ${planPath})`;
    }
  }
  if (!planContent) planContent = NO_PLAN;

  // plan hygiene (warn only)
  if (!isNoPlan(planContent)) {
    for (const w of checkPlanHygiene(planContent, config)) {
      console.error(`⚠ plan hygiene: ${w.detail}`);
    }
  }

  // spec injection
  let specContent: string | null = null;
  if (!isNoPlan(planContent)) {
    const specPath = parseSourceSpec(planContent, config);
    if (specPath) {
      specContent = readSpec(worktree, specPath, specMaxLines(config));
      if (specContent) console.error(`spec attached: ${specPath}`);
    }
  }

  return { planContent, specContent };
}
