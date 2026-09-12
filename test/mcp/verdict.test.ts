// test/mcp/verdict.test.ts — tests for verdict_submit tool

import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRun, newRun, openDb } from "../../src/db/index.js";
import { toolVerdictSubmit } from "../../src/mcp/tools/verdict.js";
import { parseToolResult } from "../../src/mcp/types.js";

function withTempDb(fn: () => void): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-verdict-"));
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

export function testVerdictSubmitInvalidVerdict(): void {
  // PLAN-verdict-stats done-criterion: reject non-grades with an error that
  // lists all 6 valid grades — including type-junk that used to slip past the
  // old loose equality check.
  for (const bad of [
    "ok",
    "maybe",
    "PASS",
    "",
    "pass-good ",
    42,
    null,
    undefined,
  ]) {
    const result = toolVerdictSubmit({
      verdict: bad,
      reason_code: "missing_test",
      regime: "code",
    });
    assert.ok(result.isError, `${JSON.stringify(bad)} should be rejected`);
    const msg = (parseToolResult(result) as { error: string }).error;
    for (const grade of [
      "pass-excellent",
      "pass-good",
      "pass-adequate",
      "pass",
      "fail",
      "uncertain",
    ]) {
      assert.ok(msg.includes(grade), `error should list grade '${grade}'`);
    }
  }
  console.log("  ✓ verdict_submit rejects invalid verdict with grade list");
}

export function testVerdictSubmitInvalidReasonCode(): void {
  const result = toolVerdictSubmit({
    verdict: "pass",
    reason_code: "bogus",
    regime: "code",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes(
      "reason_code",
    ),
  );
  console.log("  ✓ verdict_submit rejects invalid reason_code");
}

export function testVerdictSubmitOtherRequiresNote(): void {
  const result = toolVerdictSubmit({
    verdict: "fail",
    reason_code: "other",
    regime: "fix",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("note"),
  );
  console.log("  ✓ verdict_submit requires note for reason_code=other");
}

export function testVerdictSubmitRunNotFound(): void {
  const result = toolVerdictSubmit({
    run_id: 99999,
    verdict: "pass",
    reason_code: "missing_test",
    regime: "code",
  });
  const data = parseToolResult(result) as { stored: boolean; error: string };
  assert.equal(data.stored, false);
  assert.equal(data.error, "run not found");
  console.log("  ✓ verdict_submit returns error for missing run");
}

export function testVerdictSubmitSuccess(): void {
  withTempDb(() => {
    const db = openDb();
    const runId = newRun(db, "/tmp/test", null, null, "abc123");

    const result = toolVerdictSubmit({
      run_id: runId,
      verdict: "fail",
      reason_code: "missing_test",
      regime: "code",
      note: "needs integration test",
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      stored: boolean;
      run_id: number;
      verdict: string;
      reason_code: string;
      status: string;
    };
    assert.equal(data.stored, true);
    assert.equal(data.run_id, runId);
    assert.equal(data.verdict, "fail");
    assert.equal(data.reason_code, "missing_test");
    assert.equal(data.status, "fixing");
  });
  console.log("  ✓ verdict_submit stores event successfully");
}

export function testVerdictSubmitAutoCreatesRun(): void {
  withTempDb(() => {
    // Call without run_id — should auto-create a run
    const result = toolVerdictSubmit({
      verdict: "pass",
      reason_code: "missing_test",
      regime: "code",
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      stored: boolean;
      run_id: number;
      verdict: string;
      reason_code: string;
    };
    assert.equal(data.stored, true);
    assert.ok(data.run_id > 0);
    assert.equal(data.verdict, "pass");
    assert.equal(data.reason_code, "missing_test");
  });
  console.log("  ✓ verdict_submit auto-creates run when run_id omitted");
}

export function testVerdictSubmitStoresMcpSource(): void {
  withTempDb(() => {
    const db = openDb();
    const runId = newRun(db, "/tmp/test", null, null, "abc123");

    toolVerdictSubmit({
      run_id: runId,
      verdict: "pass",
      reason_code: "missing_test",
      regime: "code",
    });

    // Read back the event
    const events = db
      .prepare("SELECT data FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    const parsed = JSON.parse(events[0].data) as {
      source: string;
      verdict: string;
    };
    assert.equal(parsed.source, "mcp");
    assert.equal(parsed.verdict, "pass");
  });
  console.log("  ✓ verdict_submit marks event with source=mcp");
}

export function testVerdictSubmitAllGrades(): void {
  const grades = [
    "pass-excellent",
    "pass-good",
    "pass-adequate",
    "pass",
    "fail",
    "uncertain",
  ] as const;
  for (const grade of grades) {
    withTempDb(() => {
      const db = openDb();
      const runId = newRun(db, "/tmp/test", null, null, "abc123");
      const result = toolVerdictSubmit({
        run_id: runId,
        verdict: grade,
        reason_code: "missing_test",
        regime: "code",
      });
      assert.equal(result.isError, undefined, `${grade} should be accepted`);
      const data = parseToolResult(result) as {
        stored: boolean;
        verdict: string;
      };
      assert.equal(data.stored, true, `${grade} should store`);
      assert.equal(data.verdict, grade, `${grade} should round-trip`);
    });
  }
  console.log("  ✓ verdict_submit accepts all 6 grades");
}

interface VerdictResponse {
  stored: boolean;
  run_id?: number;
  verdict?: string;
  reason_code?: string;
  status?: string;
  round?: number;
  error?: string;
}

function submit(args: Record<string, unknown>): VerdictResponse {
  return parseToolResult(toolVerdictSubmit(args)) as VerdictResponse;
}

export function testVerdictSubmitReusesOpenRunAcrossRounds(): void {
  withTempDb(() => {
    const wt = "/tmp/reuse-wt";
    const plan = ".fapony/plan/PLAN-reuse.md";

    // Round 1: fail with no run_id → fresh run at round 1
    const r1 = submit({
      verdict: "fail",
      reason_code: "spec_gap",
      regime: "fix",
      note: "round 1",
      worktree: wt,
      plan,
    });
    assert.equal(r1.stored, true);
    assert.equal(r1.status, "fixing");
    assert.equal(r1.round, 1);

    // Round 2: same worktree+plan, no run_id → same run, round 2
    const r2 = submit({
      verdict: "fail",
      reason_code: "spec_gap",
      regime: "fix",
      note: "round 2",
      worktree: wt,
      plan,
    });
    assert.equal(r2.stored, true);
    assert.equal(r2.run_id, r1.run_id, "round 2 must bind the original run");
    assert.equal(r2.round, 2);

    // Round 3: past maxRounds (default 2) → stalled, back to the human
    const r3 = submit({
      verdict: "fail",
      reason_code: "spec_gap",
      regime: "fix",
      note: "round 3",
      worktree: wt,
      plan,
    });
    assert.equal(r3.run_id, r1.run_id, "cap verdict still lands on the run");
    assert.equal(r3.status, "stalled");
    assert.equal(r3.round, 3);
    assert.ok(r3.error?.includes("human"), "must tell caller to find a human");

    const db = openDb();
    try {
      assert.equal(getRun(db, r1.run_id!)?.status, "stalled");
      assert.equal(getRun(db, r1.run_id!)?.round, 3);
    } finally {
      db.close();
    }
  });
  console.log(
    "  ✓ verdict_submit reuses open run across rounds, stalls past cap",
  );
}

export function testVerdictSubmitNullPlanAlwaysCreatesNew(): void {
  withTempDb(() => {
    // Bare-diff reviews carry no plan — never guess they are the same work.
    const a = submit({
      verdict: "fail",
      reason_code: "other",
      regime: "review",
      note: "bare diff 1",
      worktree: "/tmp/bare-wt",
    });
    const b = submit({
      verdict: "fail",
      reason_code: "other",
      regime: "review",
      note: "bare diff 2",
      worktree: "/tmp/bare-wt",
    });
    assert.equal(a.stored, true);
    assert.equal(b.stored, true);
    assert.notEqual(a.run_id, b.run_id, "plan=null must never reuse");
  });
  console.log("  ✓ verdict_submit with no plan always opens a new run");
}

export function testVerdictSubmitPassedRunNotReused(): void {
  withTempDb(() => {
    const wt = "/tmp/passed-wt";
    const plan = ".fapony/plan/PLAN-done.md";
    const p = submit({
      verdict: "pass",
      reason_code: "other",
      regime: "code",
      note: "shipped",
      worktree: wt,
      plan,
    });
    assert.equal(p.stored, true);
    assert.equal(p.status, "passed");

    // Terminal runs stay closed — later work on the same plan opens fresh.
    const f = submit({
      verdict: "fail",
      reason_code: "missing_test",
      regime: "fix",
      note: "new work",
      worktree: wt,
      plan,
    });
    assert.equal(f.stored, true);
    assert.notEqual(f.run_id, p.run_id, "passed run must not reopen");
    assert.equal(f.round, 1);
  });
  console.log("  ✓ verdict_submit never reopens a passed run");
}

export function testVerdictSubmitMissingRegimeRejects(): void {
  const result = toolVerdictSubmit({
    verdict: "pass",
    reason_code: "missing_test",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("regime"),
  );
  console.log("  ✓ verdict_submit rejects missing regime");
}

export function testVerdictSubmitInvalidRegimeRejects(): void {
  const result = toolVerdictSubmit({
    verdict: "pass",
    reason_code: "missing_test",
    regime: "bogus",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("regime"),
  );
  console.log("  ✓ verdict_submit rejects invalid regime");
}

export function testVerdictSubmitRegimeStoredInGateEvent(): void {
  withTempDb(() => {
    const db = openDb();
    const runId = newRun(db, "/tmp/test", null, null, "abc123");

    const result = toolVerdictSubmit({
      run_id: runId,
      verdict: "pass-good",
      reason_code: "missing_test",
      regime: "code",
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as { stored: boolean; regime: string };
    assert.equal(data.stored, true);
    assert.equal(data.regime, "code");

    // Read back the event
    const events = db
      .prepare("SELECT data FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    const parsed = JSON.parse(events[0].data) as {
      regime: string;
      reason_code: string;
    };
    assert.equal(parsed.regime, "code");
    assert.equal(parsed.reason_code, "missing_test");
  });
  console.log("  ✓ verdict_submit stores regime in gate event");
}
