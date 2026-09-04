#!/usr/bin/env bun
// test/fixtures/gate.ts — stub gate reviewer for tests.
// Reads stdin, outputs VERDICT marker.

import { readFileSync } from "node:fs";

// Read stdin (the handoff/summary fapony writes)
readFileSync(0, "utf-8");

// Default to pass; override via env FIXTURE_VERDICT
const verdict = process.env.FIXTURE_VERDICT || "pass";
const note = process.env.FIXTURE_NOTE || "Looks good to me.";

process.stdout.write(`Review complete.

VERDICT: ${verdict}
${note}
`);
