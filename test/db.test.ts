import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert";
import {
  openDb,
  newRun,
  setStatus,
  addEvent,
  getRun,
  getLastPlanUpdate,
} from "../src/db.js";

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

export function testDbLifecycle(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");

    let run = getRun(db, runId);
    assert(run !== null, "run should exist");
    assert.equal(run!.status, "running");
    assert.equal(run!.round, 0);
    assert.equal(run!.worktree, "test-wt");
    assert.equal(run!.base_sha, "abc123");

    setStatus(db, runId, "awaiting_review");
    run = getRun(db, runId);
    assert.equal(run!.status, "awaiting_review");

    addEvent(db, runId, "commit", { hash: "def456" });
    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ?")
      .all(runId) as { kind: string; data: string }[];
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "commit");
    assert.deepEqual(JSON.parse(events[0].data), { hash: "def456" });

    setStatus(db, runId, "passed");
    run = getRun(db, runId);
    assert.equal(run!.status, "passed");
  });

  console.log("  ✓ db lifecycle");
}

export function testGetLastPlanUpdate(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");

    let result = getLastPlanUpdate(db, "test-wt", "mem-1");
    assert.equal(result, null, "no plan event should return null");

    addEvent(db, runId, "plan", { kind: "next_prompt", text: "Implement auth flow" });
    result = getLastPlanUpdate(db, "test-wt", "mem-1");
    assert(result !== null, "should find plan event");
    assert.equal(result!.kind, "next_prompt");
    assert.equal(result!.text, "Implement auth flow");

    addEvent(db, runId, "plan", { kind: "file_done", text: "All done." });
    result = getLastPlanUpdate(db, "test-wt", "mem-1");
    assert(result !== null, "should find latest plan event");
    assert.equal(result!.kind, "file_done");
    assert.equal(result!.text, "All done.");

    result = getLastPlanUpdate(db, "test-wt", "mem-999");
    assert.equal(result, null, "different mem_id should return null");

    result = getLastPlanUpdate(db, "other-wt", "mem-1");
    assert.equal(result, null, "different worktree should return null");
  });

  console.log("  ✓ getLastPlanUpdate");
}
