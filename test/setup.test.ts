import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSetupConfig,
  parseTimeoutMinutes,
  shouldOverwriteConfig,
  splitCmd,
  validateWorktreePath,
} from "../src/setup.js";

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

export function testBuildSetupConfigNoMemory(): void {
  const config = buildSetupConfig({
    worktreeName: "myapp",
    worktreePath: "/tmp/myapp",
    executorCmd: ["opencode", "run"],
    executorTimeout: 45,
    gateCmd: ["claude", "-p", "/code-review high"],
    autoLoop: false,
    enableMemory: false,
  });
  assert.deepStrictEqual(config.worktrees, { myapp: "/tmp/myapp" });
  assert.deepStrictEqual(config.executor, {
    cmd: ["opencode", "run"],
    timeoutMin: 45,
  });
  assert.deepStrictEqual(config.review, {
    bigDiff: { files: 15, lines: 400 },
    maxRounds: 2,
    gate: ["claude", "-p", "/code-review high"],
    prefilter: null,
    autoLoop: false,
  });
  assert.equal(config.memory, null);
  console.log("  ✓ buildSetupConfig without memory");
}

export function testBuildSetupConfigWithMemory(): void {
  const config = buildSetupConfig({
    worktreeName: "myapp",
    worktreePath: "/tmp/myapp",
    executorCmd: ["opencode", "run"],
    executorTimeout: 30,
    gateCmd: ["claude", "-p", "/code-review high"],
    autoLoop: true,
    enableMemory: true,
  });
  const mem = config.memory as Record<string, string[]>;
  assert.deepStrictEqual(mem.claim, [
    "bun",
    ".fapony/.memory/mem.ts",
    "claim",
    "{id}",
  ]);
  assert.deepStrictEqual(mem.close, [
    "bun",
    ".fapony/.memory/mem.ts",
    "close",
    "{id}",
    "{msg}",
  ]);
  assert.deepStrictEqual(mem.add, [
    "bun",
    ".fapony/.memory/mem.ts",
    "add",
    "{kind}",
    "{text}",
  ]);
  assert.deepStrictEqual(mem.kickoff, [
    "bun",
    ".fapony/.memory/mem.ts",
    "kickoff",
  ]);
  assert.equal((config.review as { autoLoop: boolean }).autoLoop, true);
  console.log("  ✓ buildSetupConfig with memory");
}

export function testValidateWorktreePath(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-setup-test-"));
  assert.equal(validateWorktreePath(dir), null);
  const missing = validateWorktreePath(join(dir, "nope"));
  assert.ok(missing?.includes("does not exist"), `got: ${missing}`);
  const empty = validateWorktreePath("");
  assert.ok(empty !== null, "empty path must fail validation");
  console.log("  ✓ validateWorktreePath");
}

export function testShouldOverwriteConfig(): void {
  assert.equal(shouldOverwriteConfig("y"), true);
  assert.equal(shouldOverwriteConfig("yes"), true);
  assert.equal(shouldOverwriteConfig("Y"), true);
  assert.equal(shouldOverwriteConfig("  yes  "), true);
  assert.equal(shouldOverwriteConfig("n"), false);
  assert.equal(shouldOverwriteConfig("no"), false);
  assert.equal(shouldOverwriteConfig(""), false);
  console.log("  ✓ shouldOverwriteConfig");
}

export function testParseTimeoutMinutes(): void {
  assert.equal(parseTimeoutMinutes("45"), 45);
  assert.equal(parseTimeoutMinutes(" 30 "), 30);
  assert.equal(parseTimeoutMinutes("garbage"), 45);
  assert.equal(parseTimeoutMinutes(""), 45);
  assert.equal(parseTimeoutMinutes("0"), 45);
  assert.equal(parseTimeoutMinutes("-5"), 45);
  console.log("  ✓ parseTimeoutMinutes");
}
