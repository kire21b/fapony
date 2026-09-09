// test/session.test.ts — detail mode for readPassiveUsage (PLAN-usage-depth A1)

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPassiveUsage } from "../src/session.js";

function withFixtureDb(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-opencode-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  try {
    db.exec(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    db.exec(
      `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT, time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, cost REAL DEFAULT 0)`,
    );
    db.exec(
      `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)`,
    );
    db.exec(`CREATE INDEX part_session_idx ON part (session_id)`);

    db.prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`).run(
      "p1",
      "/tmp/wt1",
    );
    const sess = db.prepare(
      `INSERT INTO session (id, project_id, model, time_created, tokens_input, tokens_output, cost) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    sess.run("s1", "p1", "m1", 1000, 100, 50, 0.01);
    sess.run("s2", "p1", "m1", 2000, 200, 60, 0.02);

    const part = db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, 1, 1, ?)`,
    );
    const tool = (t: string, extra = {}) =>
      JSON.stringify({ type: "tool", tool: t, ...extra });
    // s1: 2×read, 1×bash (with input/output blobs — must never leak), 2 steps
    part.run(
      "p-s1-1",
      "m1",
      "s1",
      tool("read", {
        state: { input: { filePath: "/secret" }, output: "file contents here" },
      }),
    );
    part.run("p-s1-2", "m1", "s1", tool("read"));
    part.run("p-s1-3", "m1", "s1", tool("bash"));
    part.run(
      "p-s1-4",
      "m1",
      "s1",
      JSON.stringify({
        type: "step-finish",
        tokens: { total: 19000 },
        cost: 0,
      }),
    );
    part.run(
      "p-s1-5",
      "m1",
      "s1",
      JSON.stringify({
        type: "step-finish",
        tokens: { total: 19500 },
        cost: 0,
      }),
    );
    // s2: 1×read, 1 step, 1 text part (unknown type → skip)
    part.run("p-s2-1", "m1", "s2", tool("read"));
    part.run(
      "p-s2-2",
      "m1",
      "s2",
      JSON.stringify({
        type: "step-finish",
        tokens: { total: 19000 },
        cost: 0,
      }),
    );
    part.run(
      "p-s2-3",
      "m1",
      "s2",
      JSON.stringify({ type: "text", text: "hello" }),
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

export function testSessionDefaultHasNoDetail(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage();
      assert.equal(r.session_count, 2);
      assert.equal(r.total_tokens_input, 300);
      assert.equal(r.detail, undefined, "default must not include detail");
    }),
  );
  console.log("  ✓ readPassiveUsage default has no detail (additive)");
}

export function testSessionDetailBreakdown(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      // Regression: totals identical with detail on
      assert.equal(r.session_count, 2);
      assert.equal(r.total_tokens_input, 300);
      assert.ok(r.detail, "detail:true must include detail");
      assert.deepEqual(r.detail.tool_breakdown, { read: 3, bash: 1 });
      assert.equal(r.detail.steps, 3);
      assert.equal(r.detail.by_session.length, 2);
      const s1 = r.detail.by_session.find((s) => s.session_id === "s1")!;
      assert.equal(s1.steps, 2);
      assert.deepEqual(s1.tools, { read: 2, bash: 1 });
      const s2 = r.detail.by_session.find((s) => s.session_id === "s2")!;
      assert.equal(s2.steps, 1);
      assert.deepEqual(s2.tools, { read: 1 });
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail: tool breakdown + steps per session",
  );
}

export function testSessionDetailSkipsUnknownType(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      // 'text' part in s2 must not appear anywhere in the breakdown
      const blob = JSON.stringify(r.detail);
      assert(!blob.includes("hello"), "unknown part content must not leak");
      assert(
        !blob.includes("file contents here"),
        "tool input/output must never be stored",
      );
      assert(!("text" in r.detail!.tool_breakdown), "text is not a tool");
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail skips unknown types, never stores I/O",
  );
}

export function testSessionDetailStepTokensNotSummed(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const r = readPassiveUsage(undefined, undefined, undefined, true);
      // Step tokens overlap per step — must NOT be summed; only counts.
      const blob = JSON.stringify(r.detail);
      assert(!blob.includes("19000") && !blob.includes("19500"));
      assert(!blob.includes("57500"), "no step-token sum anywhere");
      assert(typeof r.detail!.note === "string" && r.detail!.note.length > 0);
    }),
  );
  console.log(
    "  ✓ readPassiveUsage detail reports step counts, never token sums",
  );
}

export function testSessionDetailMatchesRawSql(): void {
  withFixtureDb((dbPath) =>
    withEnvDb(dbPath, () => {
      const raw = new Database(dbPath, { readonly: true });
      try {
        const expected = raw
          .prepare(
            `SELECT json_extract(data,'$.tool') AS tool, COUNT(*) AS c FROM part WHERE json_extract(data,'$.type')='tool' GROUP BY tool ORDER BY c DESC`,
          )
          .all() as Array<{ tool: string; c: number }>;
        const r = readPassiveUsage(undefined, undefined, undefined, true);
        for (const e of expected) {
          assert.equal(
            r.detail!.tool_breakdown[e.tool],
            e.c,
            `tool ${e.tool} matches raw SQL`,
          );
        }
        const steps = raw
          .prepare(
            `SELECT COUNT(*) AS n FROM part WHERE json_extract(data,'$.type')='step-finish'`,
          )
          .get() as { n: number };
        assert.equal(r.detail!.steps, steps.n, "steps match raw SQL");
      } finally {
        raw.close();
      }
    }),
  );
  console.log("  ✓ readPassiveUsage detail cross-checks against raw SQL");
}
