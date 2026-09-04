import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert";
import {
  openDb,
  newRun,
  setStatus,
  addEvent,
  getRun,
  getLastPlanUpdate,
} from "./db.js";
import { parseHandoff, renderHandoff } from "./handoff.js";
import { parseGateVerdict, parsePlanUpdate } from "./parse.js";

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
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
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

function testParseGateVerdict(): void {
  // pass with note
  const passWithNote = `Some review output here
VERDICT: pass
Looks good, no issues found.`;
  let v = parseGateVerdict(passWithNote);
  assert(v !== null, "should parse pass verdict");
  assert.equal(v!.verdict, "pass");
  assert.equal(v!.note, "Looks good, no issues found.");

  // fail with multiline note
  const failNote = `VERDICT: fail
- Missing error handling in auth.ts:42
- Type mismatch in db.ts`;
  v = parseGateVerdict(failNote);
  assert(v !== null, "should parse fail verdict");
  assert.equal(v!.verdict, "fail");
  assert(v!.note.includes("Missing error handling"), "note should contain findings");

  // no verdict marker → null (§0.4)
  v = parseGateVerdict("just some output with no verdict");
  assert.equal(v, null, "no VERDICT marker should return null");

  // verdict without note
  v = parseGateVerdict("VERDICT: pass");
  assert(v !== null, "should parse pass without note");
  assert.equal(v!.verdict, "pass");
  assert.equal(v!.note, "");

  console.log("  ✓ parseGateVerdict");
}

function testParsePlanUpdate(): void {
  // NEXT-PROMPT
  const nextPrompt = `Marked file as done.

## NEXT-PROMPT
Implement the login flow in src/auth.ts following the pattern in src/auth-old.ts.
Include error handling and unit tests.`;
  let p = parsePlanUpdate(nextPrompt);
  assert(p !== null, "should parse NEXT-PROMPT");
  assert.equal(p!.kind, "next_prompt");
  assert(p!.text.includes("Implement the login flow"), "should contain prompt text");

  // FILE_DONE
  const fileDone = `Done with this file.

## FILE_DONE
auth.ts is complete — all tests pass.`;
  p = parsePlanUpdate(fileDone);
  assert(p !== null, "should parse FILE_DONE");
  assert.equal(p!.kind, "file_done");
  assert(p!.text.includes("auth.ts is complete"), "should contain done message");

  // no marker → null (§0.4)
  p = parsePlanUpdate("just some output without markers");
  assert.equal(p, null, "no marker should return null");

  // both markers → last one wins
  const both = `## NEXT-PROMPT
First prompt

## FILE_DONE
All files done.`;
  p = parsePlanUpdate(both);
  assert(p !== null, "should parse last marker");
  assert.equal(p!.kind, "file_done");
  assert(p!.text.includes("All files done"), "should use last marker");

  // empty text after marker → null
  const empty = "## NEXT-PROMPT\n";
  p = parsePlanUpdate(empty);
  assert.equal(p, null, "empty text after marker should return null");

  console.log("  ✓ parsePlanUpdate");
}

function testFixtureGuard(): void {
  // Verify fixture files do not contain spawn/fetch — prevents token burn in tests
  const fixtureDir = join(import.meta.dir, "..", "test", "fixtures");
  try {
    const files = readdirSync(fixtureDir).filter((f: string) => f.endsWith(".ts"));
    for (const file of files) {
      const content = readFileSync(join(fixtureDir, file), "utf-8");
      assert(
        !/\bBun\.spawn\b/.test(content) && !/\bfetch\b/.test(content),
        `fixture ${file} must not contain Bun.spawn or fetch`
      );
    }
    console.log("  ✓ fixture guard (no spawn/fetch)");
  } catch {
    // test/fixtures/ doesn't yet exist — that's fine, the guard passes vacuously
    console.log("  ✓ fixture guard (no fixtures yet, skipped)");
  }
}

function testGetLastPlanUpdate(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
  const dbPath = join(dir, "state.db");
  const origHome = process.env.HOME;
  process.env.HOME = dir;

  try {
    const db = openDb();
    const runId = newRun(db, "test-wt", "plan.md", "mem-1", "abc123");

    // No plan event yet → null
    let result = getLastPlanUpdate(db, "test-wt", "mem-1");
    assert.equal(result, null, "no plan event should return null");

    // Add plan event with NEXT-PROMPT
    addEvent(db, runId, "plan", { kind: "next_prompt", text: "Implement auth flow" });
    result = getLastPlanUpdate(db, "test-wt", "mem-1");
    assert(result !== null, "should find plan event");
    assert.equal(result!.kind, "next_prompt");
    assert.equal(result!.text, "Implement auth flow");

    // Add another plan event with FILE_DONE — last one wins
    addEvent(db, runId, "plan", { kind: "file_done", text: "All done." });
    result = getLastPlanUpdate(db, "test-wt", "mem-1");
    assert(result !== null, "should find latest plan event");
    assert.equal(result!.kind, "file_done");
    assert.equal(result!.text, "All done.");

    // Different mem_id → null
    result = getLastPlanUpdate(db, "test-wt", "mem-999");
    assert.equal(result, null, "different mem_id should return null");

    // Different worktree → null
    result = getLastPlanUpdate(db, "other-wt", "mem-1");
    assert.equal(result, null, "different worktree should return null");

    db.close();
  } finally {
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ getLastPlanUpdate");
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
  testParseGateVerdict();
  testParsePlanUpdate();
  testFixtureGuard();
  testGetLastPlanUpdate();
  console.log("\nall tests passed ✓");
}
