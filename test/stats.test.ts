// test/stats.test.ts — tests for getStatsData enrichment

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginSpawn, endSpawn } from "../src/cost.js";
import {
  addEvent,
  type Config,
  incrementRound,
  newRun,
  setStatus,
} from "../src/db/index.js";
import { countPendingPlans, getStatsData } from "../src/stats.js";
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
    // Both gates share the "—"-model bucket with gateCount 2
    assert.equal(data.byModel.length, 1);
    assert.equal(data.byModel[0].model, "—");
    assert.equal(data.byModel[0].client, "—");
    assert.equal(data.byModel[0].provider, "—");
    assert.equal(data.byModel[0].agent, "—");
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
      roles: { executor: { model: "mimo-v2" } },
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

export function testStatsModelFromSessionIdWhenNoSpawn(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");

    // No spawn events — gate has session_id only
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-opencode",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    // Point OpenCode DB at a fixture that has this session
    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-gates-"));
    const dbPath = join(dir, "opencode.db");
    const ocdb = new Database(dbPath);
    ocdb.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    ocdb.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    ocdb
      .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
      .run("p1", "/tmp/wt1");
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created) VALUES (?, ?, ?, ?)`,
      )
      .run(
        "sess-opencode",
        "p1",
        '{"providerID":"anthropic","id":"claude-sonnet-5"}',
        1000,
      );
    ocdb.close();

    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      assert.equal(data.byModel[0].model, "claude-sonnet-5");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log(
    "  ✓ getStatsData: model from session_id when no spawn in window",
  );
}

export function testStatsByModelGroupsByClientProviderAgent(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");

    // Same model name on two providers — must land in two different buckets
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-zcode-1",
      reason_code: "missing_test",
      source: "mcp",
    });
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 1,
      session_id: "sess-oc-1",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-gates-split-"));
    const zcPath = join(dir, "zcode.sqlite");
    const zdb = new Database(zcPath);
    zdb.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        provider_id TEXT, agent TEXT,
        computed_total_tokens INTEGER NOT NULL DEFAULT 0
      )`,
    );
    zdb
      .prepare(
        `INSERT INTO model_usage (id, session_id, model_id, provider_id, agent, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "m1",
        "sess-zcode-1",
        "GLM-5.3-Flash",
        "builtin:zai-start-plan",
        "zcode-Explore",
        5000,
      );
    zdb.close();

    const ocPath = join(dir, "opencode.db");
    const ocdb = new Database(ocPath);
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT)`,
    );
    ocdb
      .prepare(`INSERT INTO session (id, project_id, model) VALUES (?, ?, ?)`)
      .run(
        "sess-oc-1",
        "p1",
        '{"providerID":"other-provider","id":"GLM-5.3-Flash"}',
      );
    ocdb.close();

    const prevOC = process.env.FAPONY_OPENCODE_DB;
    const prevZC = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = ocPath;
      process.env.FAPONY_ZCODE_DB = zcPath;
      const data = getStatsData();
      assert.equal(data.byModel.length, 2, "same name ≠ same bucket");
      const zc = data.byModel.find((m) => m.client === "zcode")!;
      const oc = data.byModel.find((m) => m.client === "opencode")!;
      assert.ok(zc && oc);
      assert.equal(zc.provider, "builtin:zai-start-plan");
      assert.equal(zc.model, "GLM-5.3-Flash");
      assert.equal(zc.agent, "zcode-Explore");
      assert.equal(oc.provider, "other-provider");
      assert.equal(oc.model, "GLM-5.3-Flash");
      assert.equal(oc.agent, "—");
    } finally {
      if (prevOC === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prevOC;
      if (prevZC === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prevZC;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ getStatsData: byModel splits same model across providers");
}

export function testStatsSpawnModelWinsOverSessionId(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      roles: { executor: { model: "mimo-v2" } },
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");

    // Executor spawn with model — gate also has session_id pointing elsewhere
    const s1 = beginSpawn(db, runId, config, "executor", "prompt");
    endSpawn(db, s1, config, "executor", "output");

    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", {
      verdict: "pass-good",
      note: "",
      round: 0,
      session_id: "sess-other",
      reason_code: "missing_test",
      source: "mcp",
    });
    setStatus(db, runId, "passed");

    // OpenCode DB with a *different* model for session_id
    const dir = mkdtempSync(join(tmpdir(), "fapony-stats-gates-"));
    const dbPath = join(dir, "opencode.db");
    const ocdb = new Database(dbPath);
    ocdb.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    ocdb.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    ocdb.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    ocdb
      .prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`)
      .run("p1", "/tmp/wt1");
    ocdb
      .prepare(
        `INSERT INTO session (id, project_id, model, time_created) VALUES (?, ?, ?, ?)`,
      )
      .run(
        "sess-other",
        "p1",
        '{"providerID":"anthropic","id":"claude-opus-5"}',
        1000,
      );
    ocdb.close();

    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const data = getStatsData();
      assert.equal(data.byModel.length, 1);
      // Spawn model wins — session_id is fallback only
      assert.equal(data.byModel[0].model, "mimo-v2");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  console.log("  ✓ getStatsData: spawn model wins over session_id fallback");
}

function setRunMinutes(
  db: ReturnType<typeof import("../src/db/index.js").openDb>,
  runId: number,
  minutes: number,
): void {
  db.prepare(
    `UPDATE runs SET created_at = '2026-09-09 10:00:00', updated_at = datetime('2026-09-09 10:00:00', ?) WHERE id = ?`,
  ).run(`+${minutes} minutes`, runId);
}

export function testStatsEfficiencyUsd(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");
    // 4000B in + 4000B out = $8; quality pass-good = 4; 10 minutes
    const s = beginSpawn(db, runId, config, "executor", "a".repeat(4000));
    endSpawn(db, s, config, "executor", "b".repeat(4000));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");
    setRunMinutes(db, runId, 10);

    const data = getStatsData();
    const eff = data.efficiency.find((e) => e.runId === runId)!;
    assert(eff, "efficiency entry per run");
    assert.equal(eff.grade, "pass-good");
    assert.equal(eff.quality, 4);
    assert.equal(eff.costUSD, 8);
    assert.equal(eff.basis, "usd");
    assert.equal(eff.es, 4 / (8 * 10), "ES = quality/(cost×minutes)");
    assert.equal(eff.cpq, 8 / 4, "CPQ = cost/quality");
  });
  console.log("  ✓ getStatsData: efficiency ES/CPQ from USD cost");
}

export function testStatsEfficiencyBytesProxy(): void {
  withTmpDb((db) => {
    const config = baseConfig(); // no pricing → bytes proxy
    const runId = newRun(db, "wt1", null, null, "abc");
    const s = beginSpawn(db, runId, config, "executor", "a".repeat(100));
    endSpawn(db, s, config, "executor", "b".repeat(100));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");
    setRunMinutes(db, runId, 10);

    const data = getStatsData();
    const eff = data.efficiency.find((e) => e.runId === runId)!;
    assert.equal(eff.basis, "bytes-proxy");
    assert.equal(eff.costUSD, null);
    assert.equal(eff.bytes, 200);
    assert.equal(eff.es, 4 / (200 * 10));
    assert.equal(eff.cpq, 200 / 4);
  });
  console.log("  ✓ getStatsData: efficiency falls back to bytes proxy");
}

export function testStatsEfficiencyFailIsInfinite(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");
    const s = beginSpawn(db, runId, config, "executor", "a".repeat(4000));
    endSpawn(db, s, config, "executor", "b".repeat(4000));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "fail", note: "", round: 0 });
    setStatus(db, runId, "passed");
    setRunMinutes(db, runId, 10);

    const data = getStatsData();
    const eff = data.efficiency.find((e) => e.runId === runId)!;
    assert.equal(eff.quality, 0);
    assert.equal(eff.es, 0);
    assert.equal(eff.cpq, null, "fail → censored cpq, not infinite");
  });
  console.log("  ✓ getStatsData: fail grade → ES 0, CPQ Infinity");
}

export function testStatsEfficiencyNoGateIsNull(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");
    setStatus(db, runId, "passed");
    setRunMinutes(db, runId, 10);

    const data = getStatsData();
    const eff = data.efficiency.find((e) => e.runId === runId)!;
    assert.equal(eff.grade, null);
    assert.equal(eff.quality, null);
    assert.equal(eff.es, null);
    assert.equal(eff.cpq, null);
  });
  console.log("  ✓ getStatsData: run without gate → null efficiency");
}

export function testStatsEfficiencyJsonFailCensored(): void {
  withTmpDb((db) => {
    const config: Config = {
      ...baseConfig(),
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");
    const s = beginSpawn(db, runId, config, "executor", "a".repeat(4000));
    endSpawn(db, s, config, "executor", "b".repeat(4000));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "fail", note: "", round: 0 });
    setStatus(db, runId, "passed");
    setRunMinutes(db, runId, 10);

    const data = getStatsData();
    const eff = data.efficiency.find((e) => e.runId === runId)!;
    assert.equal(eff.cpq, null);

    const serialized = JSON.parse(JSON.stringify(eff));
    assert.equal(serialized.cpq, null, "JSON must not expose Infinity/NaN");
  });
  console.log("  ✓ getStatsData: efficiency JSON round-trip censors fail CPQ");
}

// --- Cross-run knowledge (PLAN-project-health-context §2) ---

export function testStatsReasonCodeBreakdown(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    const r2 = newRun(db, "wt1", "plan-a", null, "abc");
    const r3 = newRun(db, "wt2", "plan-b", null, "abc");
    const r4 = newRun(db, "wt1", "plan-a", null, "abc");

    addEvent(db, r1, "gate", {
      verdict: "fail",
      reason_code: "scope_mismatch",
      note: "",
      round: 0,
    });
    addEvent(db, r2, "gate", {
      verdict: "fail",
      reason_code: "scope_mismatch",
      note: "",
      round: 0,
    });
    addEvent(db, r2, "gate", {
      verdict: "fail",
      reason_code: "missing_test",
      note: "",
      round: 1,
    });
    // pass gate carrying a reason_code must NOT count
    addEvent(db, r3, "gate", {
      verdict: "pass-good",
      reason_code: "scope_mismatch",
      note: "",
      round: 0,
    });
    // legacy shape: no reason_code field, [code] note prefix fallback
    addEvent(db, r4, "gate", {
      verdict: "fail",
      note: "[spec_gap] underspecified",
      round: 0,
    });

    const data = getStatsData();
    assert.equal(data.byReasonCode[0].worktree, "wt1");
    assert.equal(data.byReasonCode[0].reason, "scope_mismatch");
    assert.equal(data.byReasonCode[0].count, 2);
    const spec = data.byReasonCode.find((r) => r.reason === "spec_gap");
    assert(spec && spec.count === 1, "note-prefix fallback counts");
    assert(
      !data.byReasonCode.some((r) => r.worktree === "wt2"),
      "pass gates excluded",
    );
  });
  console.log(
    "  ✓ getStatsData: byReasonCode counts non-pass gates per worktree",
  );
}

export function testStatsEscalatedRuns(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    incrementRound(db, r1);
    incrementRound(db, r1);
    incrementRound(db, r1); // round 3 > default maxRounds 2
    const r2 = newRun(db, "wt1", "plan-b", null, "abc");
    incrementRound(db, r2); // round 1 — not escalated

    const data = getStatsData();
    assert.equal(data.escalatedRuns.length, 1);
    assert.equal(data.escalatedRuns[0].id, r1);
    assert.equal(data.escalatedRuns[0].plan, "plan-a");
    assert.equal(data.escalatedRuns[0].round, 3);
  });
  console.log("  ✓ getStatsData: escalatedRuns lists round > maxRounds");
}

export function testStatsPlanBreakdown(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "plan-a", null, "abc");
    newRun(db, "wt2", "plan-a", null, "abc");
    const r3 = newRun(db, "wt1", "plan-b", null, "abc");
    setStatus(db, r1, "passed");
    incrementRound(db, r3);
    incrementRound(db, r3);
    incrementRound(db, r3); // plan-b escalated

    const data = getStatsData();
    const a = data.byPlan.find((p) => p.plan === "plan-a");
    const b = data.byPlan.find((p) => p.plan === "plan-b");
    assert(a && b);
    assert.equal(a.runs, 2);
    assert.equal(a.passed, 1);
    assert.equal(a.escalated, 0);
    assert.deepEqual(a.worktrees, ["wt1", "wt2"]);
    assert.equal(b.escalated, 1);
  });
  console.log("  ✓ getStatsData: byPlan totals runs/passed/escalated");
}

export function testStatsBestPassing(): void {
  withTmpDb((db) => {
    const r1 = newRun(db, "wt1", "good-shape", null, "abc");
    addEvent(db, r1, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, r1, "passed");
    // round 2 pass — not a round-1 template
    const r2 = newRun(db, "wt1", "slow-shape", null, "abc");
    incrementRound(db, r2);
    incrementRound(db, r2);
    addEvent(db, r2, "gate", { verdict: "pass-good", note: "", round: 2 });
    // null plan — excluded even with round-1 pass
    const r3 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r3, "gate", { verdict: "pass-good", note: "", round: 0 });

    const data = getStatsData();
    assert.equal(data.bestPassing.length, 1);
    assert.equal(data.bestPassing[0].plan, "good-shape");
    assert.equal(data.bestPassing[0].worktree, "wt1");
  });
  console.log("  ✓ getStatsData: bestPassing only round-1 passes with a plan");
}

export function testCountPendingPlans(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-pending-"));
  try {
    // No fapony.config.json → falls back to the .fapony/plan scaffold default.
    mkdirSync(join(dir, ".fapony/plan/done"), { recursive: true });
    writeFileSync(join(dir, ".fapony/plan/PLAN-a.md"), "");
    writeFileSync(join(dir, ".fapony/plan/PLAN-b.md"), "");
    writeFileSync(join(dir, ".fapony/plan/done/PLAN-old.md"), "");
    writeFileSync(join(dir, ".fapony/plan/notes.txt"), "");
    assert.equal(countPendingPlans(dir), 2);

    // paths.planDir in the target repo's own config wins over the default.
    mkdirSync(join(dir, "apps/x/plan"), { recursive: true });
    writeFileSync(join(dir, "apps/x/plan/PLAN-c.md"), "");
    writeFileSync(
      join(dir, "fapony.config.json"),
      JSON.stringify({ paths: { planDir: "apps/x/plan" } }),
    );
    assert.equal(countPendingPlans(dir), 1);

    // Uncountable → null, never 0 ("no plan dir" must not read as "none pending").
    assert.equal(countPendingPlans(join(dir, "nope")), null);
    assert.equal(countPendingPlans("mcp-external"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ countPendingPlans: done/ excluded, null when uncountable");
}

/**
 * Tripwire: getStatsData must collect MORE notes than project_health_context
 * displays. It filters by worktree/files[] before slicing to 3, so a
 * collection cap of 3 here silently hides every file-scoped match older than
 * the three newest gates in the whole DB.
 */
export function testStatsVerdictNotesNotCappedAtDisplayLimit(): void {
  withTmpDb((db) => {
    const runId = newRun(db, "wt1", null, null, "abc");
    for (let i = 0; i < 5; i++) {
      addEvent(db, runId, "gate", {
        verdict: "fail",
        reason_code: "spec_gap",
        note: `[spec_gap] note ${i}`,
        round: i,
      });
    }

    const notes = getStatsData().recentVerdictNotes;
    assert.equal(notes.length, 5, "all notes collected, not capped at 3");
    assert.equal(notes[0].note, "note 4", "newest first, reason_code stripped");
  });
  console.log("  ✓ getStatsData: verdict notes collected past the display cap");
}
