// test/telemetry/derived-scores.test.ts — telemetry derived ES/CPQ scores

import assert from "node:assert";
import { beginSpawn, endSpawn } from "../../src/cost.js";
import { addEvent, newRun, setStatus } from "../../src/db/index.js";
import { buildPayload } from "../../src/telemetry.js";
import {
  assertClose,
  baseConfig,
  makePricedRun,
  pricedConfig,
  setRunWindow,
  withEmptyOpencodeDb,
  withTmpDb,
} from "./helpers.js";

export function testTelemetryDerivedAbsentWhenEmpty(): void {
  withEmptyOpencodeDb(() => {
    withTmpDb((_db) => {
      const payload = buildPayload();
      // Empty fapony state + empty opencode → no derived section
      assert.equal(
        payload.machine.derived,
        undefined,
        "empty db → no derived section",
      );
    });
  });

  console.log("  ✓ telemetry derived absent when no data");
}

export function testTelemetryDerivedShape(): void {
  withEmptyOpencodeDb(() => {
    withTmpDb((db) => {
      // 4000B in + 4000B out @ $4/1k = $8; quality pass-good = 4; 10 min
      makePricedRun(
        db,
        "/Users/test/project",
        "m1",
        4000,
        "pass-good",
        "2026-09-09 10:00:00",
        "2026-09-09 10:10:00",
      );

      const payload = buildPayload();
      const d = payload.machine.derived;
      assert.ok(d, "derived present with data");
      assert.equal(typeof d.tool_call_counts, "object");
      assert.equal(typeof d.efficiency_scores, "object");
      assert.equal(typeof d.cost_per_quality, "object");
      // model m1 should appear in both efficiency and cost_per_quality
      assert.equal(typeof d.efficiency_scores.m1, "number");
      assert.equal(typeof d.cost_per_quality.m1, "number");
      assertClose(d.efficiency_scores.m1, 4 / (8 * 10), "ES m1");
      assertClose(d.cost_per_quality.m1, 8 / 4, "CPQ m1");
      // Empty opencode → tool_call_counts empty
      assert.deepEqual(d.tool_call_counts, {});
    });
  });

  console.log("  ✓ telemetry derived has correct shape with data");
}

export function testTelemetryDerivedMeanOfPerRunScores(): void {
  withEmptyOpencodeDb(() => {
    withTmpDb((db) => {
      // run1: $8, ES 4/80 = 0.05, CPQ 2 — run2: $2, ES 4/20 = 0.2, CPQ 0.5
      makePricedRun(
        db,
        "/Users/test/project",
        "m1",
        4000,
        "pass-good",
        "2026-09-09 10:00:00",
        "2026-09-09 10:10:00",
      );
      makePricedRun(
        db,
        "/Users/test/project",
        "m1",
        1000,
        "pass-good",
        "2026-09-09 11:00:00",
        "2026-09-09 11:10:00",
      );

      const d = buildPayload().machine.derived;
      assert.ok(d, "derived present");
      // Mean of per-run scores — NOT ratio-of-averages (4/(5×10) = 0.08).
      assertClose(d.efficiency_scores.m1, (0.05 + 0.2) / 2, "mean ES");
      assert.ok(
        Math.abs(d.efficiency_scores.m1 - 0.08) > 1e-9,
        "must not be ratio-of-averages",
      );
      assertClose(d.cost_per_quality.m1, (2 + 0.5) / 2, "mean CPQ");
    });
  });

  console.log("  ✓ telemetry derived averages per-run ES/CPQ (mean of ratios)");
}

export function testTelemetryDerivedSkipsBytesProxyRuns(): void {
  withEmptyOpencodeDb(() => {
    withTmpDb((db) => {
      // Priced run: $8, ES 0.05, CPQ 2.
      makePricedRun(
        db,
        "/Users/test/project",
        "m1",
        4000,
        "pass-good",
        "2026-09-09 10:00:00",
        "2026-09-09 10:10:00",
      );
      // Unpriced run (no pricing → bytes proxy, 8000 bytes): must not move
      // the means — dollars and byte counts are never averaged together.
      const config = baseConfig();
      const run = newRun(db, "/Users/test/project", null, null, "abc");
      const s = beginSpawn(db, run, config, "executor", "a".repeat(4000));
      endSpawn(db, s, config, "executor", "b".repeat(4000));
      addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 0 });
      setStatus(db, run, "passed");
      setRunWindow(db, run, "2026-09-09 11:00:00", "2026-09-09 11:10:00");

      const d = buildPayload().machine.derived;
      assert.ok(d, "derived present");
      assertClose(d.efficiency_scores.m1, 0.05, "priced-run ES only");
      assertClose(d.cost_per_quality.m1, 2, "priced-run CPQ only");
    });
  });

  console.log("  ✓ telemetry derived excludes bytes-proxy runs from ES/CPQ");
}

export function testTelemetryDerivedFailDragsEsExcludesCpq(): void {
  withEmptyOpencodeDb(() => {
    withTmpDb((db) => {
      // pass-good: ES 0.05, CPQ 2 — fail: ES 0, CPQ undefined.
      makePricedRun(
        db,
        "/Users/test/project",
        "m1",
        4000,
        "pass-good",
        "2026-09-09 10:00:00",
        "2026-09-09 10:10:00",
      );
      makePricedRun(
        db,
        "/Users/test/project",
        "m1",
        4000,
        "fail",
        "2026-09-09 11:00:00",
        "2026-09-09 11:10:00",
      );

      const d = buildPayload().machine.derived;
      assert.ok(d, "derived present");
      // Fail contributes ES 0 to the mean (same as stats); CPQ mean skips it.
      assertClose(d.efficiency_scores.m1, (0.05 + 0) / 2, "fail drags ES");
      assertClose(d.cost_per_quality.m1, 2, "fail excluded from CPQ");
    });
  });

  console.log("  ✓ telemetry derived: fail counts as ES 0, excluded from CPQ");
}

export function testTelemetryDerivedAttributesLatestGateModel(): void {
  withEmptyOpencodeDb(() => {
    withTmpDb((db) => {
      // Round 1 spawns as m1, round 2 as m2 — quality comes from gate 2, so
      // the run's efficiency belongs to m2 (same rule as stats windows).
      const run = newRun(db, "/Users/test/project", null, null, "abc");
      const c1 = pricedConfig("m1");
      const s1 = beginSpawn(db, run, c1, "executor", "a".repeat(4000));
      endSpawn(db, s1, c1, "executor", "b".repeat(4000));
      addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 0 });
      const c2 = pricedConfig("m2");
      const s2 = beginSpawn(db, run, c2, "executor", "c".repeat(4000));
      endSpawn(db, s2, c2, "executor", "d".repeat(4000));
      addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 1 });
      setStatus(db, run, "passed");
      setRunWindow(db, run, "2026-09-09 10:00:00", "2026-09-09 10:10:00");

      const d = buildPayload().machine.derived;
      assert.ok(d, "derived present");
      assert.equal(typeof d.efficiency_scores.m2, "number");
      assert.equal(
        d.efficiency_scores.m1,
        undefined,
        "first-spawn model must not own the run",
      );
      // Whole-run cost $16, quality 4, 10 min → ES 4/160.
      assertClose(d.efficiency_scores.m2, 4 / (16 * 10), "ES on m2");
    });
  });

  console.log("  ✓ telemetry derived attributes runs to latest-gate model");
}
