#!/usr/bin/env bun
// test/fixtures/planner-file-done.ts — stub planner that marks file done.
// Reads stdin, outputs ## FILE_DONE.
// (Single behavior on purpose — if a test ever needs NEXT-PROMPT, use
//  planner.ts. Bun.spawn ignores process.env mutations, so the stub
//  cannot be env-toggled.)

import { readFileSync } from "node:fs";

readFileSync(0, "utf-8");

process.stdout.write(`Marked auth.ts as done.

## FILE_DONE
auth.ts is complete — all tests pass.
`);
