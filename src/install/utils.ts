// src/install/utils.ts — shared utilities for install providers

/**
 * Compute a line-by-line JSON diff between two objects.
 * Used by OpenCode and ZCode providers for dry-run output.
 */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const beforeStr = JSON.stringify(before, null, 2);
  const afterStr = JSON.stringify(after, null, 2);
  const beforeLines = beforeStr.split("\n");
  const afterLines = afterStr.split("\n");

  const diff: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b !== a) {
      if (b !== undefined) diff.push(`- ${b}`);
      if (a !== undefined) diff.push(`+ ${a}`);
    } else {
      diff.push(`  ${b}`);
    }
  }
  return diff.join("\n");
}
