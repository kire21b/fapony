import assert from "node:assert";
import {
  formatDirtyBlock,
  isUpToDate,
  parseDirtyLines,
  shouldProceedAfterDirty,
} from "../src/update.js";

export function testParseDirtyLines(): void {
  assert.deepStrictEqual(parseDirtyLines(""), []);
  assert.deepStrictEqual(parseDirtyLines(" M src/a.ts"), [" M src/a.ts"]);
  assert.deepStrictEqual(parseDirtyLines(" M a.ts\n?? b.ts\n"), [
    " M a.ts",
    "?? b.ts",
  ]);
  // blank lines never count as dirty
  assert.deepStrictEqual(parseDirtyLines("\n\n"), []);
  console.log("  ✓ parseDirtyLines");
}

export function testFormatDirtyBlock(): void {
  assert.equal(formatDirtyBlock(""), "");
  assert.equal(formatDirtyBlock(" M a.ts\n?? b.ts"), "    M a.ts\n   ?? b.ts");
  console.log("  ✓ formatDirtyBlock");
}

export function testShouldProceedAfterDirty(): void {
  assert.equal(shouldProceedAfterDirty("y"), true);
  assert.equal(shouldProceedAfterDirty("yes"), true);
  assert.equal(shouldProceedAfterDirty("Y"), true);
  assert.equal(shouldProceedAfterDirty("n"), false);
  assert.equal(shouldProceedAfterDirty("no"), false);
  assert.equal(shouldProceedAfterDirty(""), false);
  console.log("  ✓ shouldProceedAfterDirty");
}

export function testIsUpToDate(): void {
  assert.equal(isUpToDate("abc123", "abc123"), true);
  assert.equal(isUpToDate("abc123", "def456"), false);
  assert.equal(isUpToDate("unknown", "unknown"), true);
  console.log("  ✓ isUpToDate");
}
