import assert from "node:assert";
import { assertNoPromptInArgv, assertSafe } from "../src/safety.js";

export function testAssertSafe(): void {
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
        `unexpected error for ${cmd.join(" ")}: ${(e as Error).message}`,
      );
    }
  }

  const safe = [
    ["git", "status"],
    ["git", "diff", "--stat"],
    ["git", "log", "--oneline"],
    ["git", "commit", "-m", "fix: something"],
  ];

  for (const cmd of safe) {
    assertSafe(cmd);
  }

  console.log("  ✓ assertSafe");
}

export function testAssertNoPromptInArgv(): void {
  // cmd without {PROMPT} should pass
  assertNoPromptInArgv(["claude", "-p", "sonnet"], "gate");

  // cmd with {PROMPT} should throw
  assert.throws(
    () => assertNoPromptInArgv(["claude", "-p", "{model}", "{PROMPT}"], "gate"),
    /role "gate" cmd contains \{PROMPT\}/,
  );

  // {PROMPT} in any position should be caught
  assert.throws(
    () => assertNoPromptInArgv(["{PROMPT}", "claude"], "planner"),
    /role "planner" cmd contains \{PROMPT\}/,
  );

  // no false positive on similar patterns
  assertNoPromptInArgv(["echo", "PROMPT"], "test");
  assertNoPromptInArgv(["echo", "{prompt}"], "test"); // case-sensitive

  console.log("  ✓ assertNoPromptInArgv");
}
