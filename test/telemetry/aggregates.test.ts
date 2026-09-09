// test/telemetry/aggregates.test.ts — telemetry aggregates from real runs

import assert from "node:assert";
import { beginSpawn, endSpawn } from "../../src/cost.js";
import type { Config } from "../../src/db/index.js";
import { addEvent, newRun, setStatus } from "../../src/db/index.js";
import { buildPayload } from "../../src/telemetry.js";
import { baseConfig, withTmpDb } from "./helpers.js";

export function testTelemetryAggregatesFromRuns(): void {
  withTmpDb((db) => {
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
  withTmpDb((db) => {
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

export function testTelemetryPerRoundCostMultiRound(): void {
  // Regression: gate windows must be per-round (disjoint), never cumulative.
  // Two $8 rounds must average to $8 — not avg(8, 8+8) = $12.
  withTmpDb((db) => {
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
