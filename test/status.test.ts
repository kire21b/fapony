import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert";
import { openDb, newRun } from "../src/db.js";
import { renderStatusTable } from "../src/status.js";

function withTmpDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "fapony-status-test-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    const db = openDb();
    const result = fn(db);
    db.close();
    return result;
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testStatusTableShowsNothingWhenEmpty(): void {
  withTmpDb((db) => {
    assert.equal(renderStatusTable(db), "no active runs");
  });
  console.log("  ✓ status table (no active runs)");
}

export function testStatusTableShowsPlanAndMemId(): void {
  withTmpDb((db) => {
    newRun(db, "vela", ".fapony/plan/PLAN-foo.md", "mem-42", "abc123");
    const table = renderStatusTable(db);
    assert(table.includes(".fapony/plan/PLAN-foo.md"), "should show plan path");
    assert(table.includes("mem-42"), "should show mem_id");
    assert(table.includes("vela"), "should show worktree");
  });
  console.log("  ✓ status table (plan + mem_id visible)");
}
