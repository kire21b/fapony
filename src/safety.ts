// src/safety.ts — deny-list for dangerous git commands.
// Rule: assertSafe() must be called on every command before spawn, including
// ones built from config templates (mem claim/close, review gate, executor).
// Patterns come from config.safety.deny (regex sources); built-in default
// covers the 4 known-destructive git invocations.

import { DEFAULT_SAFETY_DENY } from "./db/index.js";

export function assertSafe(argv: string[], denySources?: string[]): void {
  const sources = denySources ?? DEFAULT_SAFETY_DENY;
  const joined = argv.join(" ");
  for (const src of sources) {
    if (new RegExp(src).test(joined)) {
      throw new Error(`refusing to run dangerous command: ${joined}`);
    }
  }
}
