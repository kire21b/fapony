// test/telemetry/payload.test.ts — telemetry payload shape + invariants

import assert from "node:assert";
import { buildPayload, TELEMETRY_SCHEMA_VERSION } from "../../src/telemetry.js";
import { withTmpDb } from "./helpers.js";

export function testTelemetrySchemaVersion(): void {
  const payload = buildPayload();
  assert.equal(payload.schema_version, TELEMETRY_SCHEMA_VERSION);
  assert.equal(payload.schema_version, 4);

  console.log("  ✓ telemetry schema version is 3");
}

export function testTelemetryPayloadShape(): void {
  const payload = buildPayload();

  // Top-level keys
  const keys = Object.keys(payload).sort();
  assert(keys.includes("schema_version"));
  assert(keys.includes("sent_at"));
  assert(keys.includes("machine"));
  assert(!keys.includes("runs"), "no raw runs array");
  assert(!keys.includes("events"), "no raw events array");

  // Machine section
  const m = payload.machine;
  assert.equal(typeof m.total_runs, "number");
  assert.equal(typeof m.by_status, "object");
  assert.equal(typeof m.pass_rate, "number");
  assert.equal(typeof m.stall_rate, "number");
  assert.equal(typeof m.avg_rounds, "number");
  assert.equal(typeof m.avg_minutes, "number");
  assert(Array.isArray(m.by_model));
  assert(Array.isArray(m.by_grade));
  assert(Array.isArray(m.by_worktree));

  console.log("  ✓ telemetry payload shape (aggregate, no raw rows)");
}

export function testTelemetryNoContentFields(): void {
  const payload = buildPayload();
  const blob = JSON.stringify(payload);

  // Never send content fields
  assert(!blob.includes('"plan"'), "no plan field");
  assert(!blob.includes('"note"'), "no note field");
  assert(!blob.includes('"commit"'), "no commit field");
  assert(!blob.includes('"handoff"'), "no handoff field");
  assert(!blob.includes('"source"'), "no source/diff field");
  assert(!blob.includes('"mem_id"'), "no mem_id field");

  console.log("  ✓ telemetry excludes all content fields");
}

export function testTelemetryEmptyDb(): void {
  withTmpDb((_db) => {
    const payload = buildPayload();
    assert.equal(payload.machine.total_runs, 0);
    assert.deepEqual(payload.machine.by_status, {});
    assert.equal(payload.machine.pass_rate, 0);
    assert.equal(payload.machine.stall_rate, 0);
    assert.equal(payload.machine.avg_rounds, 0);
    assert.equal(payload.machine.avg_minutes, 0);
    assert.deepEqual(payload.machine.by_model, []);
    assert.deepEqual(payload.machine.by_grade, []);
    assert.deepEqual(payload.machine.by_worktree, []);
  });

  console.log("  ✓ telemetry empty db produces zeroed aggregates");
}

export function testTelemetrySentAtIso(): void {
  const payload = buildPayload();
  assert.ok(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(payload.sent_at),
    "sent_at is ISO-8601",
  );

  console.log("  ✓ telemetry sent_at is ISO-8601");
}
