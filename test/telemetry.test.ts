import assert from "node:assert";
import { rmSync, writeFileSync } from "node:fs";
import { beginSpawn, endSpawn } from "../src/cost.js";
import {
  addEvent,
  type Config,
  loadConfig,
  newRun,
  openDb,
  setStatus,
} from "../src/db/index.js";
import { buildPayload, TELEMETRY_SCHEMA_VERSION } from "../src/telemetry.js";

function baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

function withTestDb(fn: (db: ReturnType<typeof openDb>) => void): void {
  const prev = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = `/tmp/fapony-telemetry-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    const db = openDb();
    fn(db);
    db.close();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
  }
}

export function testTelemetrySchemaVersion(): void {
  const payload = buildPayload();
  assert.equal(payload.schema_version, TELEMETRY_SCHEMA_VERSION);
  assert.equal(payload.schema_version, 2);

  console.log("  ✓ telemetry schema version is 2");
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
  assert.equal(typeof m.cost, "object");
  assert(Array.isArray(m.by_model));
  assert(Array.isArray(m.by_grade));
  assert(Array.isArray(m.by_worktree));

  // Cost shape
  assert.equal(typeof m.cost.spawns, "number");
  assert.equal(typeof m.cost.bytes_in, "number");
  assert.equal(typeof m.cost.bytes_out, "number");

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
  withTestDb((_db) => {
    const payload = buildPayload();
    assert.equal(payload.machine.total_runs, 0);
    assert.deepEqual(payload.machine.by_status, {});
    assert.equal(payload.machine.pass_rate, 0);
    assert.equal(payload.machine.stall_rate, 0);
    assert.equal(payload.machine.avg_rounds, 0);
    assert.equal(payload.machine.avg_minutes, 0);
    assert.equal(payload.machine.cost.spawns, 0);
    assert.deepEqual(payload.machine.by_model, []);
    assert.deepEqual(payload.machine.by_grade, []);
    assert.deepEqual(payload.machine.by_worktree, []);
  });

  console.log("  ✓ telemetry empty db produces zeroed aggregates");
}

export function testTelemetryAggregatesFromRuns(): void {
  withTestDb((db) => {
    const config: Config = {
      ...baseConfig(),
      roles: { executor: { model: "mimo-v2" } },
    };

    // Create 2 runs: one passed, one stalled
    const run1 = newRun(db, "/Users/test/project", null, null, "abc123");
    const run2 = newRun(db, "/Users/test/project", null, null, "def456");

    // Add spawn events with cost (model comes from config roles)
    const spawnId1 = beginSpawn(db, run1, config, "executor", "hello prompt");
    endSpawn(db, spawnId1, config, "executor", "output result");

    const spawnId2 = beginSpawn(db, run2, config, "executor", "hello prompt 2");
    endSpawn(db, spawnId2, config, "executor", "output 2");

    // Add gate events
    addEvent(db, run1, "gate", {
      verdict: "pass-good",
      note: "looks good",
      round: 1,
    });
    addEvent(db, run2, "gate", {
      verdict: "fail",
      note: "needs work",
      round: 1,
    });

    // Set statuses
    setStatus(db, run1, "passed");
    setStatus(db, run2, "stalled");

    const payload = buildPayload();

    assert.equal(payload.machine.total_runs, 2);
    assert.equal(payload.machine.by_status.passed, 1);
    assert.equal(payload.machine.by_status.stalled, 1);
    assert.equal(payload.machine.pass_rate, 0.5);
    assert.equal(payload.machine.stall_rate, 0.5);
    assert.equal(payload.machine.cost.spawns, 2);
    assert.ok(payload.machine.cost.bytes_in > 0);
    assert.ok(payload.machine.cost.bytes_out > 0);

    // By model
    assert.ok(payload.machine.by_model.length > 0);
    const mimo = payload.machine.by_model.find((m) => m.model === "mimo-v2");
    assert.ok(mimo, "mimo-v2 model found");
    assert.equal(mimo.gate_count, 2);

    // By grade
    const passGood = payload.machine.by_grade.find(
      (g) => g.grade === "pass-good",
    );
    assert.ok(passGood);
    assert.equal(passGood.count, 1);
    const fail = payload.machine.by_grade.find((g) => g.grade === "fail");
    assert.ok(fail);
    assert.equal(fail.count, 1);

    // By worktree (basename only)
    assert.ok(payload.machine.by_worktree.length > 0);
    const wt = payload.machine.by_worktree[0];
    assert.equal(wt.worktree, "project"); // basename, not full path
    assert.equal(wt.runs, 2);
    assert.equal(wt.passed, 1);
    assert.equal(wt.stalled, 1);
  });

  console.log("  ✓ telemetry aggregates from real runs");
}

export function testTelemetryWorktreeRedacted(): void {
  withTestDb((db) => {
    const run = newRun(db, "/very/long/path/to/my/project", null, null, "abc");
    setStatus(db, run, "passed");

    const payload = buildPayload();
    assert.equal(payload.machine.by_worktree[0].worktree, "project");
    assert.ok(
      !JSON.stringify(payload).includes("/very/long/path"),
      "full path not in payload",
    );
  });

  console.log("  ✓ telemetry redacts worktree paths to basename");
}

export function testTelemetrySelfReportedFromConfig(): void {
  // Self-reported metadata comes from config.telemetry.metadata
  // We test the shape here; actual config wiring is in config.test
  const payload = buildPayload();
  // No metadata configured → self_reported should be absent or empty
  if (payload.self_reported) {
    const keys = Object.keys(payload.self_reported);
    assert.ok(
      keys.every((k) => ["task_category", "stack", "notes"].includes(k)),
      "only known self-reported fields",
    );
  }

  console.log("  ✓ telemetry self-reported metadata shape");
}

export function testTelemetrySentAtIso(): void {
  const payload = buildPayload();
  assert.ok(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(payload.sent_at),
    "sent_at is ISO-8601",
  );

  console.log("  ✓ telemetry sent_at is ISO-8601");
}

export function testTelemetryPerRoundCostMultiRound(): void {
  // Regression: gate windows must be per-round (disjoint), never cumulative.
  // Two $8 rounds must average to $8 — not avg(8, 8+8) = $12.
  withTestDb((db) => {
    const config: Config = {
      ...baseConfig(),
      roles: { executor: { model: "m" } },
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const run = newRun(db, "/Users/test/project", null, null, "abc");
    const s1 = beginSpawn(db, run, config, "executor", "a".repeat(4000));
    endSpawn(db, s1, config, "executor", "b".repeat(4000));
    addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 1 });
    const s2 = beginSpawn(db, run, config, "executor", "a".repeat(4000));
    endSpawn(db, s2, config, "executor", "b".repeat(4000));
    addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 2 });
    setStatus(db, run, "passed");

    const payload = buildPayload();
    assert.equal(payload.machine.cost.usd_estimate, 16);
    const m = payload.machine.by_model.find((x) => x.model === "m");
    assert.ok(m, "model m found");
    assert.equal(m.gate_count, 2);
    assert.equal(m.avg_cost_usd, 8);
    assert.equal(m.avg_quality, 4);
  });

  console.log(
    "  ✓ telemetry per-round (not cumulative) cost on multi-round runs",
  );
}

export function testTelemetrySelfReportedRoundTrip(): void {
  // Metadata set in fapony.config.json must arrive verbatim in the payload.
  withTestDb((_db) => {
    const prevConfig = process.env.FAPONY_CONFIG;
    const cfgPath = `/tmp/fapony-telemetry-cfg-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`;
    writeFileSync(
      cfgPath,
      JSON.stringify({
        telemetry: {
          metadata: { task_category: "bugfix", stack: "bun" },
        },
      }),
    );
    process.env.FAPONY_CONFIG = cfgPath;
    try {
      const payload = buildPayload();
      assert.deepEqual(payload.self_reported, {
        task_category: "bugfix",
        stack: "bun",
      });
    } finally {
      if (prevConfig === undefined) delete process.env.FAPONY_CONFIG;
      else process.env.FAPONY_CONFIG = prevConfig;
      rmSync(cfgPath, { force: true });
    }
  });

  console.log("  ✓ telemetry self-reported metadata round-trips from config");
}
