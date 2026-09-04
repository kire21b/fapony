#!/usr/bin/env bun
// test/fixtures/planner.ts — stub planner for tests.
// Reads stdin, outputs NEXT-PROMPT or FILE_DONE marker.

import { readFileSync } from "node:fs";

// Read stdin (the plan + git facts + handoff fapony writes)
readFileSync(0, "utf-8");

// Default to NEXT-PROMPT; override via FIXTURE_PLANNER_ACTION
const action = process.env.FIXTURE_PLANNER_ACTION || "next_prompt";

if (action === "file_done") {
  process.stdout.write(`All done.

## FILE_DONE
auth.ts — login flow implemented with tests.
`);
} else {
  process.stdout.write(`Marked auth.ts as done.

## NEXT-PROMPT
Implement the registration flow in src/register.ts following the same pattern as src/auth.ts.
Include validation and error handling.
`);
}
