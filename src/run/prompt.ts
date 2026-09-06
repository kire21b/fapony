// src/run/prompt.ts — executor prompt builder + command resolver

import type { Config } from "../db/index.js";
import { templateArgs } from "../util.js";

/**
 * Build the executor prompt from a template. Values are inserted via function
 * replacements so `$` sequences in plan/spec/feedback text are literal.
 */
export function buildExecutorPrompt(
  template: string,
  planContent: string,
  memId: string | null,
  specContent: string | null,
  feedback: string | null,
): string {
  return template
    .replace("{{PLAN}}", () => planContent)
    .replace("{{MEM_ID}}", () => memId ?? "none")
    .replace("{{SPEC}}", () => specContent ?? "(no spec)")
    .replace("{{FEEDBACK}}", () => feedback ?? "(none — first round)");
}

/**
 * Executor spawn command: roles.executor.cmd wins when set ({{model}} filled
 * from roles.executor.model), otherwise the plain executor.cmd.
 */
export function executorCmd(config: Config, memId: string | null): string[] {
  const role = config.roles?.executor;
  const cmd = role?.cmd ?? config.executor.cmd;
  return templateArgs(cmd, { id: memId ?? "none", model: role?.model ?? "" });
}
