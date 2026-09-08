// test/mcp/verdict.test.ts — tests for verdict_submit tool

import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newRun, openDb } from "../../src/db/index.js";
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
