import assert from "node:assert";
import { parseHandoff, renderHandoff } from "../src/handoff.js";

export function testParseHandoff(): void {
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

  const withoutBlock = "Some random output with no handoff block";
  const missing = parseHandoff(withoutBlock);
  assert.equal(missing.missing, true);

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

export function testRenderHandoff(): void {
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
