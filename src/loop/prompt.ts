// src/loop/prompt.ts — render a role prompt from template file or inline fallback.

import { readFileSync } from "node:fs";
import { type Config, promptFileFor } from "../db/index.js";
import { fillPrompt } from "../util.js";

/**
 * Render a role prompt: when prompts.<role> points at a template file, fill
 * its {{VARS}}; otherwise use the builtin inline fallback. A missing/unreadable
 * file falls back instead of crashing the loop.
 */
export function renderRolePrompt(
  config: Config,
  role: "gate" | "planner" | "bigFixer",
  fallback: string,
  vars: Record<string, string>,
): string {
  const file = promptFileFor(config, role);
  if (!file) return fallback;
  try {
    return fillPrompt(readFileSync(file, "utf-8"), vars);
  } catch {
    console.error(`prompt file unreadable: ${file} — using builtin fallback`);
    return fallback;
  }
}
