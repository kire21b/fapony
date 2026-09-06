import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newRun, openDb } from "../src/db/index.js";
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

export function testStatusTableTruncatesLongMemId(): void {
  withTmpDb((db) => {
    // a real run hit this: mem_id "demo-status-1" (13 chars) broke column
    // alignment because only `plan` was truncated, not `mem_id`.
    newRun(
      db,
      "fapony",
      ".fapony/plan/PLAN-status-test.md",
      "demo-status-1",
      "abc123",
    );
    const table = renderStatusTable(db);
    const [, header, , dataLine] = table.split("\n");
    assert.equal(
      dataLine.split("|").length,
      header.split("|").length,
      "long mem_id should not add an extra column separator",
    );
  });
  console.log("  ✓ status table (long mem_id truncated, columns stay aligned)");
}
