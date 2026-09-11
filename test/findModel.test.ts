// test/findModel.test.ts — tests for findSessionModel (session log model resolution)

import { Database } from "bun:sqlite";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSessionModel } from "../src/session/findModel.js";

// --- OpenCode fixture ---

function withOpenCodeFixture(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-opencode-"));
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL)`,
    );
    db.run(
      `CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model TEXT,
        time_created INTEGER NOT NULL, tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0, cost REAL DEFAULT 0
      )`,
    );
    db.run(
      `CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
      )`,
    );
    // Plain-text model
    db.prepare(
      `INSERT INTO session (id, project_id, model, time_created) VALUES (?, ?, ?, ?)`,
    ).run(
      "sess-plain",
      "p1",
      '{"providerID":"anthropic","id":"claude-sonnet-5"}',
      1000,
    );
    db.prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`).run(
      "p1",
      "/tmp/wt1",
    );
    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testFindSessionModelOpenCodeHit(): void {
  withOpenCodeFixture((dbPath) => {
    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const result = findSessionModel("sess-plain");
      assert.ok(result, "should find session");
      assert.equal(result!.model, "claude-sonnet-5");
      assert.equal(result!.provider, "anthropic");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel OpenCode hit");
}

export function testFindSessionModelOpenCodeMiss(): void {
  withOpenCodeFixture((dbPath) => {
    const prev = process.env.FAPONY_OPENCODE_DB;
    try {
      process.env.FAPONY_OPENCODE_DB = dbPath;
      const result = findSessionModel("nonexistent");
      assert.equal(result, null);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_OPENCODE_DB;
      else process.env.FAPONY_OPENCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel OpenCode miss → null");
}

// --- ZCode fixture ---

function withZcodeFixture(fn: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-zcode-"));
  const dbPath = join(dir, "db.sqlite");
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, directory TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      )`,
    );
    db.run(
      `CREATE TABLE model_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0, cache_creation_input_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0, computed_total_tokens INTEGER DEFAULT 0
      )`,
    );
    db.prepare(
      `INSERT INTO session (id, project_id, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`,
    ).run("z1", "p1", "/tmp/zwt", 1700000000, 1700000100);
    db.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, input_tokens, output_tokens, computed_total_tokens) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("mu1", "z1", "claude-opus-5", 1000, 500, 1500);
    fn(dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testFindSessionModelZcodeHit(): void {
  withZcodeFixture((dbPath) => {
    const prev = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = findSessionModel("z1");
      assert.ok(result, "should find session");
      assert.equal(result!.model, "claude-opus-5");
    } finally {
      if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel ZCode hit");
}

export function testFindSessionModelZcodeMiss(): void {
  withZcodeFixture((dbPath) => {
    const prev = process.env.FAPONY_ZCODE_DB;
    try {
      process.env.FAPONY_ZCODE_DB = dbPath;
      const result = findSessionModel("nonexistent");
      assert.equal(result, null);
    } finally {
      if (prev === undefined) delete process.env.FAPONY_ZCODE_DB;
      else process.env.FAPONY_ZCODE_DB = prev;
    }
  });
  console.log("  ✓ findSessionModel ZCode miss → null");
}

// --- Claude Code fixture ---

function withClaudeCodeFixture(fn: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-claude-"));
  const filePath = join(dir, "session-1.jsonl");
  const content = [
    JSON.stringify({
      message: {
        model: "claude-sonnet-5",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      timestamp: "2026-09-09T03:00:00.000Z",
    }),
  ].join("\n");
  writeFileSync(filePath, content);
  try {
    fn(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testFindSessionModelClaudeCodeHit(): void {
  withClaudeCodeFixture((filePath) => {
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "claude-sonnet-5");
    assert.equal(result!.provider, "anthropic");
  });
  console.log("  ✓ findSessionModel Claude Code hit");
}

export function testFindSessionModelClaudeCodeMiss(): void {
  const result = findSessionModel("/nonexistent/path/session.jsonl");
  assert.equal(result, null);
  console.log("  ✓ findSessionModel Claude Code miss → null");
}

// --- Codex fixture ---

function withCodexFixture(fn: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-fm-codex-"));
  const filePath = join(dir, "rollout.jsonl");
  const content = [
    JSON.stringify({
      timestamp: "2026-09-09T10:59:01.413Z",
      type: "session_meta",
      payload: {
        session_id: "abc-123",
        cwd: "/tmp/test",
        model_provider: "openai",
        model: "gpt-5.6-terra",
      },
    }),
    JSON.stringify({
      timestamp: "2026-09-09T10:59:09.677Z",
      type: "token_usage_record",
      payload: {
        session_id: "abc-123",
        usage: { input_tokens: 1000, output_tokens: 50 },
      },
    }),
  ].join("\n");
  writeFileSync(filePath, content);
  try {
    fn(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testFindSessionModelCodexHit(): void {
  withCodexFixture((filePath) => {
    const result = findSessionModel(filePath);
    assert.ok(result, "should find session");
    assert.equal(result!.model, "gpt-5.6-terra");
    assert.equal(result!.provider, "openai");
  });
  console.log("  ✓ findSessionModel Codex hit");
}

export function testFindSessionModelCodexMiss(): void {
  const result = findSessionModel("/nonexistent/path/rollout.jsonl");
  assert.equal(result, null);
  console.log("  ✓ findSessionModel Codex miss → null");
}

// --- Edge cases ---

export function testFindSessionModelEmptyId(): void {
  const result = findSessionModel("");
  assert.equal(result, null);
  console.log("  ✓ findSessionModel empty string → null");
}

export function testFindSessionModelNoReadersAvailable(): void {
  // Point all DBs to nonexistent paths — should return null, not throw
  const prevOC = process.env.FAPONY_OPENCODE_DB;
  const prevZC = process.env.FAPONY_ZCODE_DB;
  try {
    process.env.FAPONY_OPENCODE_DB = "/nonexistent/oc.db";
    process.env.FAPONY_ZCODE_DB = "/nonexistent/zc.db";
    const result = findSessionModel("any-id");
    assert.equal(result, null);
  } finally {
    if (prevOC === undefined) delete process.env.FAPONY_OPENCODE_DB;
    else process.env.FAPONY_OPENCODE_DB = prevOC;
    if (prevZC === undefined) delete process.env.FAPONY_ZCODE_DB;
    else process.env.FAPONY_ZCODE_DB = prevZC;
  }
  console.log("  ✓ findSessionModel no readers → null");
}
