#!/usr/bin/env bun
// test/fixtures/gate.ts — stub gate reviewer for tests.
// Reads stdin, outputs a canned VERDICT: pass.
// (Single behavior on purpose — if a test ever needs fail, add a
//  gate-fail.ts fixture instead of env-toggling this one. Bun.spawn
//  ignores process.env mutations, so env toggles silently don't work.)

import { readFileSync } from "node:fs";

// Read stdin (the handoff/summary fapony writes)
readFileSync(0, "utf-8");

process.stdout.write(`Review complete.

VERDICT: pass
Looks good to me.
`);
