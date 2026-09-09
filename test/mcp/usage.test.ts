// test/mcp/usage.test.ts — fapony_usage detail:true (PLAN-usage-depth A3)

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolPassiveUsage } from "../../src/mcp/tools/usage.js";
import { readPassiveUsage } from "../../src/session/index.js";

function withFixtureDb(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-usage-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    db.run(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    db.run(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    db.prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`).run(
      "p1",
      "/tmp/wt1",
    );
    db.prepare(
      `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("s1", "p1", "m1", 1000, 100, 50, 0.01);
    const part = db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, 1, 1, ?)`,
    );
    part.run("q1", "m1", "s1", JSON.stringify({ type: "tool", tool: "read" }));
    part.run("q2", "m1", "s1", JSON.stringify({ type: "tool", tool: "bash" }));
    part.run(
      "q3",
      "m1",
      "s1",
      JSON.stringify({ type: "step-finish", cost: 0 }),
    );
    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function withEnvDb(dbPath: string, fn: () => void): void {
  const prev = process.env.FAPONY_OPENCODE_DB;
  process.env.FAPONY_OPENCODE_DB = dbPath;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prev;
  }
}

export function testUsageDefaultRegression(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const before = readPassiveUsage();
      const viaTool = toolPassiveUsage({});
      assert.equal(viaTool.isError, undefined);
      const text = viaTool.content[0].text;
      // Default text: compact, no Detail section
      assert(!text.includes("Detail"), "default text must not include Detail");
      assert(text.includes("Sessions: 1"));
      assert.equal(before.session_count, 1);
      assert.equal(before.detail, undefined);
    }),
  );
  console.log("  ✓ fapony_usage default output unchanged (regression)");
}

export function testUsageDetailJson(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const viaTool = toolPassiveUsage({ json: true, detail: true });
      const data = JSON.parse(viaTool.content[0].text);
      assert.equal(data.session_count, 1);
      assert.ok(data.detail, "json+detail must include detail");
      assert.deepEqual(data.detail.tool_breakdown, { read: 1, bash: 1 });
      assert.equal(data.detail.steps, 1);
      assert.equal(data.detail.by_session.length, 1);
      // Default json has no detail key
      const plain = JSON.parse(
        toolPassiveUsage({ json: true }).content[0].text,
      );
      assert.equal(plain.detail, undefined);
    }),
  );
  console.log("  ✓ fapony_usage detail:true json includes breakdown");
}

export function testUsageDetailText(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const text = toolPassiveUsage({ detail: true }).content[0].text;
      assert(
        text.includes("Detail"),
        "detail text must include Detail section",
      );
      assert(text.includes("read: 1"));
      assert(text.includes("steps: 1"));
    }),
  );
  console.log("  ✓ fapony_usage detail:true text includes breakdown");
}
