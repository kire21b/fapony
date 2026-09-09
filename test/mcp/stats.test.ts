// test/mcp/stats.test.ts — tests for fapony_stats MCP tool

import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginSpawn, endSpawn } from "../../src/cost.js";
import {
  addEvent,
  type Config,
  loadConfig,
  newRun,
  openDb,
  setStatus,
} from "../../src/db/index.js";
import { toolFaponyStats } from "../../src/mcp/tools/stats.js";
import { cmdStats } from "../../src/stats.js";

function withTempDb(fn: () => void): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-stats-"));
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

function baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

export function testStatsToolEmptyDb(): void {
  withTempDb(() => {
    const result = toolFaponyStats({});
    assert.equal(result.isError, undefined);
    // text mode = raw CLI text, not JSON-wrapped
    assert.equal(result.content[0].text, "no runs yet");
  });
  console.log("  ✓ fapony_stats returns 'no runs yet' for empty db");
}

export function testStatsToolJsonMode(): void {
  withTempDb(() => {
    const db = openDb();
    const config = baseConfig();
    const runId = newRun(db, "wt1", null, null, "abc");
    const s = beginSpawn(db, runId, config, "executor", "prompt");
    endSpawn(db, s, config, "executor", "output");
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const result = toolFaponyStats({ json: true });
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    const data = JSON.parse(text);
    // Must parse back to StatsData shape — pure JSON, no prefix/suffix
    assert.equal(typeof data.runs.total, "number");
    assert.equal(typeof data.runs.passRate, "number");
    assert.ok(Array.isArray(data.byModel));
    assert.ok(Array.isArray(data.byGrade));
    assert.ok(Array.isArray(data.byWorktree));
  });
  console.log("  ✓ fapony_stats json:true returns parseable StatsData");
}

export function testStatsToolTextMode(): void {
  withTempDb(() => {
    const db = openDb();
    const runId = newRun(db, "wt1", null, null, "abc");
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    const result = toolFaponyStats({ json: false });
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    // raw text, not a JSON envelope
    assert.ok(text.startsWith("runs: 1"), "text mode is raw CLI text");
    assert.ok(text.includes("pass rate:"));
    assert.ok(text.includes("by grade:"));
    assert.ok(text.includes("pass-good"));
  });
  console.log("  ✓ fapony_stats json:false returns raw CLI-format text");
}

export function testStatsTextMatchesCli(): void {
  withTempDb(() => {
    const db = openDb();
    const config: Config = {
      ...baseConfig(),
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const runId = newRun(db, "wt1", null, null, "abc");
    const s = beginSpawn(db, runId, config, "executor", "a".repeat(4000));
    endSpawn(db, s, config, "executor", "b".repeat(4000));
    addEvent(db, runId, "route", {});
    addEvent(db, runId, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, runId, "passed");

    // Capture CLI output
    const origLog = console.log;
    const captured: string[] = [];
    console.log = (...a: unknown[]) => {
      captured.push(a.join(" "));
    };
    try {
      cmdStats([]);
    } finally {
      console.log = origLog;
    }
    const cliText = captured.join("\n");
    const mcpText = toolFaponyStats({}).content[0].text;

    // SPEC-verdict-stats: "text เดียวกับ fapony stats — ใช้ formatter ตัวเดียวกัน"
    assert.equal(
      mcpText,
      cliText,
      "MCP text mode must equal CLI output byte-for-byte",
    );
  });
  console.log("  ✓ fapony_stats text mode === fapony stats CLI output");
}

export function testStatsToolByGradeSeparation(): void {
  withTempDb(() => {
    const db = openDb();
    const r1 = newRun(db, "wt1", null, null, "abc");
    const r2 = newRun(db, "wt1", null, null, "abc");
    addEvent(db, r1, "gate", { verdict: "pass-good", note: "", round: 0 });
    setStatus(db, r1, "passed");
    addEvent(db, r2, "gate", { verdict: "fail", note: "", round: 0 });
    setStatus(db, r2, "fixing");

    const result = toolFaponyStats({ json: true });
    const data = JSON.parse(result.content[0].text);
    const grades = data.byGrade.map((g: { grade: string }) => g.grade);
    assert.ok(grades.includes("pass-good"), "should have pass-good");
    assert.ok(grades.includes("fail"), "should have fail");
    assert.notEqual(
      grades.indexOf("pass-good"),
      grades.indexOf("fail"),
      "grades should be separate",
    );
  });
  console.log("  ✓ fapony_stats separates grades in byGrade");
}

export function testStatsEfficiencyTextFailCensored(): void {
  withTempDb(() => {
    const db = openDb();
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

    const text = toolFaponyStats({ json: false }).content[0].text;
    assert.ok(
      text.includes("derived: efficiency"),
      "text should include derived section",
    );
    assert.ok(
      !text.includes("Infinity"),
      "text must not display Infinity for fail CPQ",
    );
    // Find the efficiency section (between "derived:" header and next blank line)
    const effStart = text.indexOf("derived: efficiency");
    const effEnd = text.indexOf("\n\n", effStart);
    const effSection = text.slice(
      effStart,
      effEnd > effStart ? effEnd : undefined,
    );
    const line = effSection
      .split("\n")
      .find((l) => l.includes(String(runId)) && l.includes("|"))!;
    assert.ok(line, "should have efficiency line for the run");
    const cpqField = line.split("|")[3]!.trim();
    assert.equal(cpqField, "—", "fail CPQ should render as censored dash");
  });
  console.log("  ✓ fapony_stats efficiency text censors fail CPQ");
}
