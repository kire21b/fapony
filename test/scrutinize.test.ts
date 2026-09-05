import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import assert from "node:assert";
import type { Config } from "../src/db.js";
import {
  shouldScrutinizeFix,
  buildScrutinizePrompt,
  resolveChangedFiles,
  spawnScrutinizeFix,
} from "../src/loop.js";
import { createTestRepo } from "./fixtures/repo.js";

function makeConfig(withRole: boolean): Config {
  return {
    worktrees: { test: "/tmp/test" },
    executor: { cmd: ["opencode", "run"], timeoutMin: 45 },
    roles: withRole
      ? { scrutinizeFix: { cmd: ["bun", "stub"], timeoutMin: 15 } }
      : { executor: { cmd: ["bun", "stub"] } },
    review: {
      bigDiff: { files: 15, lines: 400 },
      maxRounds: 2,
      gate: ["claude", "-p", "/code-review high"],
      prefilter: null,
    },
    memory: null,
  };
}

export function testShouldScrutinizeFix(): void {
  const withRole = makeConfig(true);
  const noRole = makeConfig(false);
  const smallAwaiting = { isBig: false, status: "awaiting_review" };

  assert.equal(shouldScrutinizeFix(smallAwaiting, withRole), true, "small + role + awaiting_review should trigger");

  // Mirror of the bigFixer lane owns big diffs — never both
  assert.equal(
    shouldScrutinizeFix({ isBig: true, status: "awaiting_review" }, withRole),
    false,
    "big diff belongs to bigFixer, not scrutinize-fix"
  );
  assert.equal(shouldScrutinizeFix(smallAwaiting, noRole), false, "no role should not trigger");
  assert.equal(
    shouldScrutinizeFix({ isBig: false, status: "fixing" }, withRole),
    false,
    "fixing status should not trigger"
  );
  assert.equal(
    shouldScrutinizeFix({ isBig: false, status: "stalled" }, withRole),
    false,
    "stalled status should not trigger"
  );

  console.log("  ✓ shouldScrutinizeFix routing");
}

export function testBuildScrutinizePrompt(): void {
  const prompt = buildScrutinizePrompt(
    "/wt-test",
    { runId: 7, facts: { files: 2, lines: 30, commits: ["abc123"], branch: "main" } },
    "src/a.ts\nsrc/b.ts"
  );

  assert(prompt.includes('repo_root="/wt-test"'), "should carry repo_root for the role");
  assert(prompt.includes("Run ID: 7"), "should carry run id");
  assert(prompt.includes("src/a.ts"), "should list changed files, not auto-detect");
  assert(prompt.includes("2 files"), "should carry diff size");
  assert(prompt.includes("VERDICT"), "should embed the role prompt template");

  console.log("  ✓ buildScrutinizePrompt");
}

export function testResolveChangedFiles(): void {
  const repo = createTestRepo();
  try {
    assert.equal(
      resolveChangedFiles(repo.dir, null),
      "(unknown — base sha unavailable)",
      "missing base should fall back to sentinel"
    );

    const base = execSync("git rev-parse HEAD", { cwd: repo.dir, encoding: "utf-8" }).trim();
    assert.equal(resolveChangedFiles(repo.dir, base), "(none)", "clean diff should report none");

    writeFileSync(join(repo.dir, "fix.ts"), "export const x = 1;\n");
    execSync("git add fix.ts && git commit -m 'add fix'", { cwd: repo.dir, stdio: "ignore" });
    const listed = resolveChangedFiles(repo.dir, base);
    assert(listed.includes("fix.ts"), `should list changed file, got: ${listed}`);
  } finally {
    repo.cleanup();
  }

  console.log("  ✓ resolveChangedFiles");
}

// spawnScrutinizeFix opens the db internally (no run row → unknown-files
// fallback), so isolate its location like the gate/db tests do.
// ponytail: bug fix — Bun caches os.homedir() at process start, so setting
// process.env.HOME here never redirected openDb(); this was silently writing
// into the real ~/.config/fapony/state.db on every test run.
async function withTmpHome<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "fapony-test-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    return await fn();
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function testSpawnScrutinizeFix(): Promise<void> {
  const repo = createTestRepo();
  try {
    await withTmpHome(async () => {
      const fixture = join(import.meta.dir, "fixtures", "scrutinize-fix.ts");
      const config = makeConfig(true);
      config.roles!.scrutinizeFix = { cmd: ["bun", fixture], timeoutMin: 1 };

      const runResult = {
        runId: 99999, // no db row — exercises the unknown-files fallback
        facts: { files: 2, lines: 30, commits: ["abc123"], branch: "main" },
        parsed: { missing: false },
      };

      const out = await spawnScrutinizeFix(config, repo.dir, runResult);
      assert(out !== null, "stub output should be returned");
      assert(out!.includes("Scrutinize pass complete"), "should return stub stdout");

      const log = execSync("git log --oneline", { cwd: repo.dir, encoding: "utf-8" });
      assert(log.includes("scrutinize stub"), "fire-and-forget should commit its own fix");

      // Empty output → null: loop must continue to gate with the original diff
      // (separate fixture — Bun.spawn ignores process.env mutations, so no env toggle)
      config.roles!.scrutinizeFix = { cmd: ["bun", join(import.meta.dir, "fixtures", "scrutinize-fix-empty.ts")], timeoutMin: 1 };
      const empty = await spawnScrutinizeFix(config, repo.dir, runResult);
      assert.equal(empty, null, "empty stub output should map to null");
    });
  } finally {
    repo.cleanup();
  }

  console.log("  ✓ spawnScrutinizeFix (stub + empty-output null path)");
}

export async function testSpawnScrutinizeFixRejectsDangerousCmd(): Promise<void> {
  const repo = createTestRepo();
  try {
    await withTmpHome(async () => {
      const config = makeConfig(true);
      config.roles!.scrutinizeFix = { cmd: ["git", "reset", "--hard"], timeoutMin: 1 };
      const runResult = {
        runId: 1,
        facts: { files: 1, lines: 10, commits: [], branch: "main" },
        parsed: { missing: true },
      };
      // assertSafe sits outside the try (same as spawnBigFixer) — dangerous
      // config must fail loudly, never masquerade as "empty output → null".
      let threw = false;
      try {
        await spawnScrutinizeFix(config, repo.dir, runResult);
      } catch (e) {
        threw = true;
        assert((e as Error).message.includes("dangerous"), "should refuse dangerous command");
      }
      assert(threw, "dangerous cmd should throw, not spawn");
    });
  } finally {
    repo.cleanup();
  }

  console.log("  ✓ spawnScrutinizeFix assertSafe");
}
