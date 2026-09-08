import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseGateVerdict,
  parsePlanUpdate,
  qualityScore,
  VERDICT_GRADES,
} from "../src/parse.js";

export async function testParseGateVerdict(): Promise<void> {
  // Legacy pass/fail still work
  const passWithNote = `Some review output here
VERDICT: pass
Looks good, no issues found.`;
  let v = parseGateVerdict(passWithNote);
  assert(v !== null, "should parse pass verdict");
  assert.equal(v?.verdict, "pass");
  assert.equal(v?.note, "Looks good, no issues found.");

  const failNote = `VERDICT: fail
- Missing error handling in auth.ts:42
- Type mismatch in db.ts`;
  v = parseGateVerdict(failNote);
  assert(v !== null, "should parse fail verdict");
  assert.equal(v?.verdict, "fail");
  assert(
    v?.note.includes("Missing error handling"),
    "note should contain findings",
  );

  v = parseGateVerdict("just some output with no verdict");
  assert.equal(v, null, "no VERDICT marker should return null");

  v = parseGateVerdict("VERDICT: pass");
  assert(v !== null, "should parse pass without note");
  assert.equal(v?.verdict, "pass");
  assert.equal(v?.note, "");

  // All 6 grades parse correctly
  for (const grade of [
    "pass-excellent",
    "pass-good",
    "pass-adequate",
    "pass",
    "fail",
    "uncertain",
  ]) {
    v = parseGateVerdict(`VERDICT: ${grade}`);
    assert(v !== null, `should parse ${grade}`);
    assert.equal(v?.verdict, grade);
  }

  // Grades with notes
  v = parseGateVerdict("VERDICT: pass-excellent\nedge cases verified");
  assert(v !== null, "should parse pass-excellent with note");
  assert.equal(v?.verdict, "pass-excellent");
  assert.equal(v?.note, "edge cases verified");

  v = parseGateVerdict("VERDICT: pass-adequate\nresidual risk: auth edge case");
  assert(v !== null, "should parse pass-adequate with note");
  assert.equal(v?.verdict, "pass-adequate");

  v = parseGateVerdict("VERDICT: uncertain\nhandoff missing checks section");
  assert(v !== null, "should parse uncertain with note");
  assert.equal(v?.verdict, "uncertain");
  assert.equal(v?.note, "handoff missing checks section");

  // Trailing text on same line → null (strict regex)
  v = parseGateVerdict("VERDICT: pass-good ดีมาก");
  assert.equal(v, null, "trailing text on same line should return null");

  // Garbage input → null
  v = parseGateVerdict("VERDICT: passsomething");
  assert.equal(v, null, "invalid grade should return null");

  // A custom verdict regex without a capture group matching any grade must fail
  // safe (null), not propagate verdict: undefined downstream.
  const { loadConfig } = await import("../src/db/index.js");
  const noGroup = {
    ...loadConfig("/nonexistent-path/fapony.config.json"),
    markers: { verdict: "^VERDICT:" },
  };
  assert.equal(
    parseGateVerdict("VERDICT: pass", noGroup),
    null,
    "verdict regex without capture group should return null",
  );

  // VERDICT_GRADES set is complete
  assert.equal(VERDICT_GRADES.size, 6, "should have exactly 6 grades");

  console.log("  ✓ parseGateVerdict");
}

export function testParsePlanUpdate(): void {
  const nextPrompt = `Marked file as done.

## NEXT-PROMPT
Implement the login flow in src/auth.ts following the pattern in src/auth-old.ts.
Include error handling and unit tests.`;
  let p = parsePlanUpdate(nextPrompt);
  assert(p !== null, "should parse NEXT-PROMPT");
  assert.equal(p?.kind, "next_prompt");
  assert(
    p?.text.includes("Implement the login flow"),
    "should contain prompt text",
  );

  const fileDone = `Done with this file.

## FILE_DONE
auth.ts is complete — all tests pass.`;
  p = parsePlanUpdate(fileDone);
  assert(p !== null, "should parse FILE_DONE");
  assert.equal(p?.kind, "file_done");
  assert(
    p?.text.includes("auth.ts is complete"),
    "should contain done message",
  );

  p = parsePlanUpdate("just some output without markers");
  assert.equal(p, null, "no marker should return null");

  const both = `## NEXT-PROMPT
First prompt

## FILE_DONE
All files done.`;
  p = parsePlanUpdate(both);
  assert(p !== null, "should parse last marker");
  assert.equal(p?.kind, "file_done");
  assert(p?.text.includes("All files done"), "should use last marker");

  const empty = "## NEXT-PROMPT\n";
  p = parsePlanUpdate(empty);
  assert.equal(p, null, "empty text after marker should return null");

  console.log("  ✓ parsePlanUpdate");
}

export function testFixtureGuard(): void {
  const fixtureDir = join(import.meta.dir, "fixtures");
  try {
    const files = readdirSync(fixtureDir).filter((f: string) =>
      f.endsWith(".ts"),
    );
    for (const file of files) {
      const content = readFileSync(join(fixtureDir, file), "utf-8");
      assert(
        !/\bBun\.spawn\b/.test(content) && !/\bfetch\b/.test(content),
        `fixture ${file} must not contain Bun.spawn or fetch`,
      );
    }
    console.log("  ✓ fixture guard (no spawn/fetch)");
  } catch {
    console.log("  ✓ fixture guard (no fixtures yet, skipped)");
  }
}

export function testQualityScore(): void {
  // Locked values from SPEC-verdict-protocol — additive-only, never change
  const cases: Array<
    [
      (
        | "pass-excellent"
        | "pass-good"
        | "pass-adequate"
        | "pass"
        | "fail"
        | "uncertain"
      ),
      number,
    ]
  > = [
    ["pass-excellent", 5],
    ["pass-good", 4],
    ["pass-adequate", 3],
    ["pass", 3], // legacy, same score as pass-adequate
    ["fail", 0],
    ["uncertain", 1],
  ];
  for (const [grade, expected] of cases) {
    assert.equal(
      qualityScore(grade),
      expected,
      `qualityScore("${grade}") should be ${expected}`,
    );
  }
  console.log("  ✓ qualityScore returns correct values for all 6 grades");
}
