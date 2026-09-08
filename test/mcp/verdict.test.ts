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
  const result = toolVerdictSubmit({
    verdict: "maybe",
    reason_code: "missing_test",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("verdict"),
  );
  console.log("  ✓ verdict_submit rejects invalid verdict");
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
