#!/usr/bin/env bun
// test/fixtures/executor.ts — stub executor for tests.
// Reads stdin, creates a dummy commit, outputs HANDOFF marker.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Read stdin (the prompt fapony writes)
readFileSync(0, "utf-8");

// Create a dummy file and commit (so gitFacts > 0, route = small)
writeFileSync("fixture-output.txt", `generated at ${new Date().toISOString()}\n`);
execSync("git add fixture-output.txt", { stdio: "ignore" });
execSync('git commit -m "test: executor stub" --allow-empty', { stdio: "ignore" });

const hash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();

process.stdout.write(`Some executor output here.

## HANDOFF
claimed: none
commits: ${hash}
checks: typecheck pass
uncertain: none
not_done: none
`);
