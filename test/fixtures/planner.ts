#!/usr/bin/env bun
// test/fixtures/planner.ts — stub planner for tests.
// Reads stdin, outputs a canned ## NEXT-PROMPT.
// (Single behavior on purpose — if a test ever needs FILE_DONE, add a
//  planner-file-done.ts fixture instead of env-toggling this one. Bun.spawn
//  ignores process.env mutations, so env toggles silently don't work.)

import { readFileSync } from "node:fs";

// Read stdin (the plan + git facts + handoff fapony writes)
readFileSync(0, "utf-8");

process.stdout.write(`Marked auth.ts as done.

## NEXT-PROMPT
Implement the registration flow in src/register.ts following the same pattern as src/auth.ts.
Include validation and error handling.
`);
