import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert";
import {
  openDb,
  newRun,
  setStatus,
  addEvent,
  getRun,
} from "./db.js";
import { parseHandoff, renderHandoff } from "./handoff.js";

function testAssertSafe(): void {
  // These should throw (dangerous)
  const dangerous = [
    ["git", "reset", "--hard", "HEAD~1"],
    ["git", "clean", "-fd"],
    ["git", "clean", "-f"],
    ["git", "checkout", "--", "."],
    ["git", "stash"],
  ];

  for (const cmd of dangerous) {
    try {
      assertSafe(cmd);
      assert.fail(`should have thrown for: ${cmd.join(" ")}`);
    } catch (e) {
      assert(
        (e as Error).message.includes("dangerous"),
        `unexpected error for ${cmd.join(" ")}: ${(e as Error).message}`
      );
    }
  }

  // These should pass (safe)
  const safe = [
    ["git", "status"],
    ["git", "diff", "--stat"],
    ["git", "log", "--oneline"],
    ["git", "commit", "-m", "fix: something"],
  ];

  for (const cmd of safe) {
    assertSafe(cmd); // should not throw
  }

  console.log("  ✓ assertSafe");
}

function testParseHandoff(): void {
  // With block
  const withBlock = `
Some output here
## HANDOFF
claimed: abc123
commits: a1b2c3 d4e5f6
checks: typecheck pass
uncertain: the auth flow might need refactoring
not_done: tests
  `.trim();

  const parsed = parseHandoff(withBlock);
  assert.equal(parsed.missing, false);
  assert.equal(parsed.claimed, "abc123");
  assert.deepEqual(parsed.commits, ["a1b2c3", "d4e5f6"]);
  assert.equal(parsed.checks, "typecheck pass");
  assert.deepEqual(parsed.uncertain, ["the auth flow might need refactoring"]);
  assert.deepEqual(parsed.not_done, ["tests"]);

  // Without block
  const withoutBlock = "Some random output with no handoff block";
  const missing = parseHandoff(withoutBlock);
  assert.equal(missing.missing, true);

  // Block with "none" values
  const noneBlock = `
## HANDOFF
claimed: none
commits: none
checks: none
uncertain: none
not_done: none
  `.trim();

  const noneParsed = parseHandoff(noneBlock);
  assert.equal(noneParsed.missing, false);
  assert.equal(noneParsed.claimed, "none");
  assert.deepEqual(noneParsed.commits, []);

  console.log("  ✓ parseHandoff");
}

function testDbLifecycle(): void {
  const dir = mkdtempSync(join(tmpdir(), "symphor-test-"));
  const dbPath = join(dir, "state.db");

  // Override dbPath for this test by temporarily patching
  const origHome = process.env.HOME;
  process.env.HOME = dir;

  try {
    const db = openDb();
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");

    let run = getRun(db, runId);
    assert(run !== null, "run should exist");
    assert.equal(run!.status, "running");
    assert.equal(run!.round, 0);
    assert.equal(run!.worktree, "test-wt");
    assert.equal(run!.base_sha, "abc123");

    setStatus(db, runId, "awaiting_review");
    run = getRun(db, runId);
    assert.equal(run!.status, "awaiting_review");

    addEvent(db, runId, "commit", { hash: "def456" });
    const events = db
      .prepare("SELECT * FROM events WHERE run_id = ?")
      .all(runId) as { kind: string; data: string }[];
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "commit");
    assert.deepEqual(JSON.parse(events[0].data), { hash: "def456" });

    setStatus(db, runId, "passed");
    run = getRun(db, runId);
    assert.equal(run!.status, "passed");

    db.close();
  } finally {
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ db lifecycle");
}

function testRenderHandoff(): void {
  const facts = { files: 3, lines: 120, commits: ["a1b2", "c3d4"], branch: "main" };
  const parsed = parseHandoff(
    "## HANDOFF\nclaimed: x\ncommits: a1b2 c3d4\nchecks: ok\nuncertain: maybe\nnot_done: none"
  );
  const output = renderHandoff(facts, parsed);
  assert(output.includes("files changed: 3"));
  assert(output.includes("executor report"));
  assert(output.includes("claimed: x"));

  const missingParsed = parseHandoff("no block here");
  const missingOutput = renderHandoff(facts, missingParsed);
  assert(missingOutput.includes("no ## HANDOFF block"));

  console.log("  ✓ renderHandoff");
}

// Duplicated from run.ts to avoid circular import in test
const DANGEROUS_PATTERNS = [
  /reset\s+--hard/,
  /clean\s+-[a-z]*f/,
  /checkout\s+--\s/,
  /git\s+stash/,
];

function assertSafe(argv: string[]): void {
  const joined = argv.join(" ");
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(joined)) {
      throw new Error(`refusing to run dangerous command: ${joined}`);
    }
  }
}

export async function cmdTest(): Promise<void> {
  console.log("running tests...\n");
  testAssertSafe();
  testParseHandoff();
  testDbLifecycle();
  testRenderHandoff();
  console.log("\nall tests passed ✓");
}
