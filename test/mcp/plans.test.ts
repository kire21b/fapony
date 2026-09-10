// test/mcp/plans.test.ts — tests for plan_list tool

import assert from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEvent, newRun, openDb } from "../../src/db/index.js";
import { toolPlanList } from "../../src/mcp/tools/plans.js";
import { parseToolResult } from "../../src/mcp/types.js";

function withTempDb(fn: () => void): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-plans-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    fn();
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
}

function makeWorktree(): string {
  const wt = mkdtempSync(join(tmpdir(), "fapony-plans-wt-"));
  mkdirSync(join(wt, ".fapony", "plan", "done"), { recursive: true });
  return wt;
}

export function testPlanListRequiresWorktree(): void {
  const result = toolPlanList({});
  assert.ok(result.isError);
  console.log("  ✓ plan_list requires worktree");
}

export function testPlanListMissingDir(): void {
  const wt = mkdtempSync(join(tmpdir(), "fapony-plans-empty-"));
  const result = toolPlanList({ worktree: wt });
  const data = parseToolResult(result) as { pending: unknown[]; done: number };
  assert.deepEqual(data.pending, []);
  assert.equal(data.done, 0);
  console.log("  ✓ plan_list handles missing plan dir");
}

export function testPlanListNeverAttempted(): void {
  withTempDb(() => {
    const wt = makeWorktree();
    writeFileSync(
      join(wt, ".fapony", "plan", "PLAN-foo.md"),
      "# Foo plan\n\nbody",
    );
    const result = toolPlanList({ worktree: wt });
    const data = parseToolResult(result) as {
      pending: { file: string; title: string; runs: number; last: string }[];
      done: number;
    };
    assert.equal(data.pending.length, 1);
    assert.equal(data.pending[0].file, "PLAN-foo.md");
    assert.equal(data.pending[0].title, "Foo plan");
    assert.equal(data.pending[0].runs, 0);
    assert.equal(data.pending[0].last, "never attempted");
    assert.equal(data.done, 0);
  });
  console.log("  ✓ plan_list reports never-attempted plans");
}

export function testPlanListJoinsRunHistory(): void {
  withTempDb(() => {
    const wt = makeWorktree();
    const planPath = join(wt, ".fapony", "plan", "PLAN-bar.md");
    writeFileSync(planPath, "# Bar plan\n\nbody");
    writeFileSync(join(wt, ".fapony", "plan", "done", "PLAN-old.md"), "# Old");

    const db = openDb();
    const runId = newRun(db, "myproj", planPath, null, "abc123");
    addEvent(db, runId, "gate", { verdict: "fail", reason_code: "spec_gap" });

    const result = toolPlanList({ worktree: wt });
    const data = parseToolResult(result) as {
      pending: { file: string; runs: number; last: string }[];
      done: number;
    };
    const bar = data.pending.find((p) => p.file === "PLAN-bar.md");
    assert.ok(bar);
    assert.equal(bar?.runs, 1);
    assert.equal(bar?.last, "fail(spec_gap)");
    assert.equal(data.done, 1);
  });
  console.log("  ✓ plan_list joins pending plan against run history");
}
