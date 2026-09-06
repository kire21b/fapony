import assert from "node:assert";
import { splitCmd } from "../src/setup.js";

export function testSplitCmdSimpleArgs(): void {
  const result = splitCmd("opencode run");
  assert.deepStrictEqual(result, ["opencode", "run"]);
  console.log("  ✓ splitCmd simple args");
}

export function testSplitCmdQuotedArg(): void {
  // The original bug: default gate has quotes around the last arg
  const result = splitCmd('claude -p "/code-review high"');
  assert.deepStrictEqual(result, ["claude", "-p", "/code-review high"]);
  console.log("  ✓ splitCmd quoted arg (bug regression)");
}

export function testSplitCmdMultipleQuotedArgs(): void {
  const result = splitCmd('cmd "arg one" "arg two" plain');
  assert.deepStrictEqual(result, ["cmd", "arg one", "arg two", "plain"]);
  console.log("  ✓ splitCmd multiple quoted args");
}

export function testSplitCmdEmptyString(): void {
  const result = splitCmd("");
  assert.deepStrictEqual(result, []);
  console.log("  ✓ splitCmd empty string");
}

export function testSplitCmdNoQuotes(): void {
  const result = splitCmd("opencode run --model mimo");
  assert.deepStrictEqual(result, ["opencode", "run", "--model", "mimo"]);
  console.log("  ✓ splitCmd no quotes");
}

export function testSplitCmdEmptyQuotedString(): void {
  const result = splitCmd('cmd "" plain');
  assert.deepStrictEqual(result, ["cmd", "", "plain"]);
  console.log("  ✓ splitCmd empty quoted string");
}
