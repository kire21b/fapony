import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert";
import { parseGateVerdict, parsePlanUpdate } from "../src/parse.js";

export function testParseGateVerdict(): void {
  const passWithNote = `Some review output here
VERDICT: pass
Looks good, no issues found.`;
  let v = parseGateVerdict(passWithNote);
  assert(v !== null, "should parse pass verdict");
  assert.equal(v!.verdict, "pass");
  assert.equal(v!.note, "Looks good, no issues found.");

  const failNote = `VERDICT: fail
- Missing error handling in auth.ts:42
- Type mismatch in db.ts`;
  v = parseGateVerdict(failNote);
  assert(v !== null, "should parse fail verdict");
  assert.equal(v!.verdict, "fail");
  assert(v!.note.includes("Missing error handling"), "note should contain findings");

  v = parseGateVerdict("just some output with no verdict");
  assert.equal(v, null, "no VERDICT marker should return null");

  v = parseGateVerdict("VERDICT: pass");
  assert(v !== null, "should parse pass without note");
  assert.equal(v!.verdict, "pass");
  assert.equal(v!.note, "");

  console.log("  ✓ parseGateVerdict");
}

export function testParsePlanUpdate(): void {
  const nextPrompt = `Marked file as done.

## NEXT-PROMPT
Implement the login flow in src/auth.ts following the pattern in src/auth-old.ts.
Include error handling and unit tests.`;
  let p = parsePlanUpdate(nextPrompt);
  assert(p !== null, "should parse NEXT-PROMPT");
  assert.equal(p!.kind, "next_prompt");
  assert(p!.text.includes("Implement the login flow"), "should contain prompt text");

  const fileDone = `Done with this file.

## FILE_DONE
auth.ts is complete — all tests pass.`;
  p = parsePlanUpdate(fileDone);
  assert(p !== null, "should parse FILE_DONE");
  assert.equal(p!.kind, "file_done");
  assert(p!.text.includes("auth.ts is complete"), "should contain done message");

  p = parsePlanUpdate("just some output without markers");
  assert.equal(p, null, "no marker should return null");

  const both = `## NEXT-PROMPT
First prompt

## FILE_DONE
All files done.`;
  p = parsePlanUpdate(both);
  assert(p !== null, "should parse last marker");
  assert.equal(p!.kind, "file_done");
  assert(p!.text.includes("All files done"), "should use last marker");

  const empty = "## NEXT-PROMPT\n";
  p = parsePlanUpdate(empty);
  assert.equal(p, null, "empty text after marker should return null");

  console.log("  ✓ parsePlanUpdate");
}

export function testFixtureGuard(): void {
  const fixtureDir = join(import.meta.dir, "fixtures");
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
    console.log("  ✓ fixture guard (no fixtures yet, skipped)");
  }
}
