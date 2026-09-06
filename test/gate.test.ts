import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRun, newRun, openDb, setStatus } from "../src/db/index.js";
import { gateOnce } from "../src/gate.js";

function withTmpDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
  const orig = process.env.FAPONY_STATE_DIR;
  // ponytail: bug fix — Bun caches os.homedir() at process start, so setting
  // process.env.HOME here never redirected openDb(); every "isolated" test db
  // was silently writing into the real ~/.config/fapony/state.db.
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

export function testGateOncePass(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    const result = gateOnce(runId, "pass", "looks good");
    assert.equal(result.status, "passed");
    assert.equal(result.error, undefined);

    const run = getRun(db, runId);
    assert.equal(run?.status, "passed");

    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    assert.deepEqual(JSON.parse(events[0].data), {
      verdict: "pass",
      note: "looks good",
    });
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
    assert.equal(run?.status, "fixing");
    assert.equal(run?.round, 1);
  });

  console.log("  ✓ gateOnce fail");
}

export function testGateOnceAlreadyPassed(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "passed");

    const result = gateOnce(runId, "pass", "");
    assert.equal(result.status, "passed");
    assert(result.error?.includes("already"), "should say already passed");
  });

  console.log("  ✓ gateOnce already passed");
}

export function testGateOnceMaxRounds(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");
    setStatus(db, runId, "awaiting_review");

    // Fail twice — round 1 and 2 (still allowed since 2 > 2 is false)
    gateOnce(runId, "fail", "round 1");
    const r1 = getRun(db, runId)!;
    assert.equal(r1.round, 1);

    setStatus(db, runId, "awaiting_review");
    gateOnce(runId, "fail", "round 2");
    const r2 = getRun(db, runId)!;
    assert.equal(r2.round, 2);

    // Third fail — round 3 > 2, so stops
    setStatus(db, runId, "awaiting_review");
    const result = gateOnce(runId, "fail", "round 3");
    assert.equal(result.status, "stopped");
    assert(result.error?.includes("maxRounds"), "should mention maxRounds");

    // stopped must be persisted (run must not sit in 'fixing' forever)
    assert.equal(getRun(db, runId)?.status, "stopped");
    const stops = db
      .prepare("SELECT * FROM events WHERE run_id = ? AND kind = 'stop'")
      .all(runId) as { data: string }[];
    assert.equal(stops.length, 1);
  });

  console.log("  ✓ gateOnce max rounds");
}
