#!/usr/bin/env bun
// test/fixtures/gate-fail.ts — stub gate reviewer that fails.
// Reads stdin, outputs VERDICT: fail with findings.
// (Single behavior on purpose — if a test ever needs uncertain, add a
//  gate-uncertain.ts fixture instead of env-toggling this one. Bun.spawn
//  ignores process.env mutations, so env toggles silently don't work.)

import { readFileSync } from "node:fs";

readFileSync(0, "utf-8");

process.stdout.write(`Review complete.

VERDICT: fail
- Missing error handling in auth flow
- Type mismatch in return value
`);
