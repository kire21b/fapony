import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert";
import { openDb, newRun, setStatus, getRun, addEvent } from "../src/db.js";
import { gateOnce } from "../src/gate.js";

function withTmpDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
  const origHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const db = openDb();
    const result = fn(db);
    db.close();
    return result;
  } finally {
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testGateOncePass(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "pass", "looks good");
    assert.equal(result.status, "passed");
    assert.equal(result.error, undefined);

    const run = getRun(db, runId);
    assert.equal(run!.status, "passed");

    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0].data), { verdict: "pass", note: "looks good" });
  });

  console.log("  ✓ gateOnce pass");
}

export function testGateOnceFail(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "fail", "fix auth");
    assert.equal(result.status, "fixing");
    assert.equal(result.round, 1);

    const run = getRun(db, runId);
    assert.equal(run!.status, "fixing");
    assert.equal(run!.round, 1);
  });

  console.log("  ✓ gateOnce fail");
}

export function testGateOnceAlreadyPassed(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "passed");

    const result = gateOnce(runId, "pass", "");
    assert.equal(result.status, "passed");
    assert(result.error!.includes("already"), "should say already passed");
  });

  console.log("  ✓ gateOnce already passed");
}

export function testGateOnceMaxRounds(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    // Fail twice to hit maxRounds (default maxRounds = 2)
    gateOnce(runId, "fail", "round 1");
    const r1 = getRun(db, runId)!;
    assert.equal(r1.round, 1);

    setStatus(db, runId, "awaiting_review");
    const result = gateOnce(runId, "fail", "round 2");
    assert.equal(result.status, "stopped");
    assert(result.error!.includes("maxRounds"), "should mention maxRounds");
  });

  console.log("  ✓ gateOnce max rounds");
}
