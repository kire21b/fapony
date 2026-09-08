// test/stats.test.ts — tests for getStatsData enrichment

import assert from "node:assert";
import { beginSpawn, endSpawn } from "../src/cost.js";
import { addEvent, type Config, newRun, setStatus } from "../src/db/index.js";
import { getStatsData } from "../src/stats.js";
import { baseConfig, withTmpDb } from "./helpers.js";

export function testStatsEmptyDb(): void {
  withTmpDb(() => {
    const data = getStatsData();
    assert.equal(data.runs.total, 0);
    assert.deepEqual(data.byModel, []);
    assert.deepEqual(data.byGrade, []);
    assert.deepEqual(data.byWorktree, []);
  });
  console.log("  ✓ getStatsData returns empty for no runs");
}

export function testStatsNoPricingValueIsNull(): void {
  withTmpDb((db) => {
    const config = baseConfig();
    const runId = newRun(db, "wt1", null, null, "abc");

    // Spawn executor with no pricing
    const spawnId = beginSpawn(db, runId, config, "executor", "prompt text");
    endSpawn(db, spawnId, config, "executor", "output text");

    // Route + gate
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    assert.equal(data.runs.total, 1);
    assert.equal(data.byModel.length, 1);
    assert.equal(data.byModel[0].avgCostUSD, null, "no pricing → costUSD null");
    assert.equal(data.byModel[0].avgValue, null, "no pricing → value null");
    assert.equal(data.byGrade.length, 1);
    assert.equal(data.byGrade[0].avgCostUSD, null);
  });
  console.log("  ✓ getStatsData: no pricing → null costUSD/value");
}

export function testStatsZeroCostValueIsNull(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      pricing: { executor: { inputPer1k: 1, outputPer1k: 1 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");

    // Spawn with zero bytes (cost = 0)
    const spawnId = beginSpawn(db, runId, config, "executor", "");
    endSpawn(db, spawnId, config, "executor", "");

    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    // costUSD might be 0 or null depending on estimateUsd, but valueScore must be null
    assert.equal(data.byModel[0].avgValue, null, "zero cost → value null");
  });
  console.log("  ✓ getStatsData: zero cost → valueScore null");
}

export function testStatsMultiRoundSeparateGates(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");

    // Round 1: spawn → route → gate(fail)
    const s1 = beginSpawn(db, runId, config, "executor", "a".repeat(4000));
    endSpawn(db, s1, config, "executor", "b".repeat(4000));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "fail", note: "", round: 0 });

    // Round 2: spawn → route → gate(pass)
    const s2 = beginSpawn(db, runId, config, "executor", "c".repeat(8000));
    endSpawn(db, s2, config, "executor", "d".repeat(8000));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 1 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    // 2 gates, each with its own cost
    assert.equal(data.byGrade.length, 2, "2 different grades");
    const failGrade = data.byGrade.find((g) => g.grade === "fail");
    const passGrade = data.byGrade.find((g) => g.grade === "pass-good");
    assert(failGrade && passGrade);
    // Exact per-round USD: 4000B in + 4000B out = 1000+1000 tok @ $4/1k = $8;
    // round 2 is double: $16. Cumulative (WRONG) would show $24 for gate 2.
    assert.equal(failGrade.avgCostUSD, 8, "gate 1 cost = round 1 spawns only");
    assert.equal(
      passGrade.avgCostUSD,
      16,
      "gate 2 cost = round 2 spawns only, not cumulative",
    );
    // Both gates share the (unknown)-model bucket with gateCount 2
    assert.equal(data.byModel.length, 1);
    assert.equal(data.byModel[0].model, "(unknown)");
    assert.equal(data.byModel[0].gateCount, 2);
    // avgQuality over fail(0) + pass-good(4) = 2
    assert.equal(data.byModel[0].avgQuality, 2);
  });
  console.log("  ✓ getStatsData: multi-round gates counted separately");
}

export function testStatsGateWithoutSpawnsInWindow(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");

    // spawn → gate(pass-good) → gate(fail) with NO spawn between the gates
    const s = beginSpawn(db, runId, config, "executor", "a".repeat(4000));
    endSpawn(db, s, config, "executor", "b".repeat(4000));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    addEvent(db, runId, "gate", { verdict: "fail", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    const fail = data.byGrade.find((g) => g.grade === "fail");
    const passGood = data.byGrade.find((g) => g.grade === "pass-good");
    assert(fail && passGood);
    // All spawn cost belongs to gate 1's window; gate 2 has none.
    assert.equal(passGood.avgCostUSD, 8, "gate 1 owns the spawn cost");
    assert.equal(fail.avgCostUSD, null, "gate 2 window empty → null, not 0");
    assert.equal(fail.count, 1, "gate 2 still counted in byGrade");
    // valueScore: gate 1 = 4/8 = 0.5; gate 2 null → avg over non-null only
    assert.equal(data.byModel[0].avgValue, 0.5);
  });
  console.log(
    "  ✓ getStatsData: gate with empty spawn window → null cost, still counted",
  );
}

export function testStatsLegacyPassMergedWithPassAdequate(): void {
  withTmpDb((db) => {
    const runId1 = newRun(db, "wt1", null, null, "abc");
    const runId2 = newRun(db, "wt1", null, null, "abc");

    // run with legacy "pass"
    addEvent(db, runId1, "gate", { verdict: "pass", note: "", round: 0 });
    setStatus(db, runId1, "passed");

    // run with "pass-adequate"
    addEvent(db, runId2, "gate", {
      verdict: "pass-adequate",
      note: "",
      round: 0,
    });
    setStatus(db, runId2, "passed");

    const data = getStatsData();
    // Should be separate entries, NOT merged
    const legacyPass = data.byGrade.find((g) => g.grade === "pass");
    const passAdequate = data.byGrade.find((g) => g.grade === "pass-adequate");
    assert(legacyPass, "should have legacy pass grade");
    assert(passAdequate, "should have pass-adequate grade");
    assert.equal(legacyPass.count, 1);
    assert.equal(passAdequate.count, 1);
  });
  console.log("  ✓ getStatsData: legacy 'pass' separate from 'pass-adequate'");
}

export function testStatsByWorktree(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt-a", null, null, "abc");
    const r2 = newRun(db, "wt-a", null, null, "abc");
    const r3 = newRun(db, "wt-b", null, null, "abc");

    setStatus(db, r1, "passed");
    setStatus(db, r2, "stalled");
    setStatus(db, r3, "passed");

    const data = getStatsData();
    assert.equal(data.byWorktree.length, 2);
    const a = data.byWorktree.find((w) => w.worktree === "wt-a");
    const b = data.byWorktree.find((w) => w.worktree === "wt-b");
    assert(a && b);
    assert.equal(a.runs, 2);
    assert.equal(a.passed, 1);
    assert.equal(a.stalled, 1);
    assert.equal(b.runs, 1);
    assert.equal(b.passed, 1);
  });
  console.log("  ✓ getStatsData: byWorktree counts correct");
}

export function testStatsModelFromExecutorSpawn(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      roles: { executor: { cmd: ["x"], model: "mimo-v2" } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");

    // Executor spawn with specific model
    const s1 = beginSpawn(db, runId, config, "executor", "prompt");
    endSpawn(db, s1, config, "executor", "output");
    // Gate spawn (different role)
    const s2 = beginSpawn(db, runId, config, "gate", "gate prompt");
    endSpawn(db, s2, config, "gate", "gate output");

    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const data = getStatsData();
    // Model should be from executor, not gate
    assert.equal(data.byModel.length, 1);
    assert.equal(data.byModel[0].model, "mimo-v2");
  });
  console.log("  ✓ getStatsData: model attribution from executor spawn");
}
