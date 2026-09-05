#!/usr/bin/env bun
// test/fixtures/scrutinize-fix-empty.ts — stub that produces no output.
// Tests the fire-and-forget null path: loop must continue to gate
// with the original diff.
// (Separate file — not env-toggled — because Bun.spawn does not pick up
//  process.env mutations made after the parent started.)

import { readFileSync } from "node:fs";

// Read stdin (the role prompt + run context fapony writes)
readFileSync(0, "utf-8");

process.exit(0);
