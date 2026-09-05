#!/usr/bin/env bun
// test/fixtures/scrutinize-fix.ts — stub scrutinize-fix role for tests.
// Reads stdin, commits a dummy fix, outputs a short summary.
// (Empty-output case lives in scrutinize-fix-empty.ts — Bun.spawn does not
//  pick up process.env mutations, so the stub cannot be env-toggled.)

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Read stdin (the role prompt + run context fapony writes)
readFileSync(0, "utf-8");

// Commit a dummy fix (so callers can verify fire-and-forget committed)
writeFileSync("scrutinize-output.txt", `fixed at ${new Date().toISOString()}\n`);
execSync("git add scrutinize-output.txt", { stdio: "ignore" });
execSync('git commit -m "fix: scrutinize stub" --allow-empty', { stdio: "ignore" });

process.stdout.write(`Scrutinize pass complete.

[NIT] scrutinize-output.txt:1 | stub finding
VERDICT: pass
No blockers found.
`);
