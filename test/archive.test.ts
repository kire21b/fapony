import assert from "node:assert";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { autoArchivePlan } from "../src/loop/index.js";
import { createTestRepo } from "./fixtures/repo.js";

const DATED_NAME_RE = /^\d{4}-\d{2}-\d{2}-PLAN-test\.md$/;

/** Find the one file archive put in done/ — its name is now date-prefixed. */
function archivedFile(dir: string): string {
  const doneDir = join(dir, ".fapony", "plan", "done");
  const [name] = readdirSync(doneDir).filter((f) => DATED_NAME_RE.test(f));
  assert(name, `expected a date-prefixed PLAN-test.md in ${doneDir}`);
  return join(doneDir, name);
}

function writePlan(dir: string, content: string): string {
  mkdirSync(join(dir, ".fapony", "plan"), { recursive: true });
  const planPath = join(dir, ".fapony", "plan", "PLAN-test.md");
  writeFileSync(planPath, content);
  execSync("git add .fapony/plan/PLAN-test.md && git commit -m 'add plan'", {
    cwd: dir,
    stdio: "ignore",
  });
  return planPath;
}

export function testAutoArchivePlanSynthesizesHeader(): void {
  const repo = createTestRepo();
  try {
    writePlan(repo.dir, "# Test Plan\n\nAll items done.\n");

    const result = autoArchivePlan(repo.dir, ".fapony/plan/PLAN-test.md");
    assert.equal(result.ok, true, `should archive: ${result.error}`);

    const moved = archivedFile(repo.dir);
    assert(existsSync(moved), "plan should be moved to .fapony/plan/done/");
    assert(
      /^>\s*✅\s*\*\*.*shipped.*\*\*/.test(readFileSync(moved, "utf-8")),
      "should synthesize shipped header",
    );

    const log = execSync("git log --oneline", {
      cwd: repo.dir,
      encoding: "utf-8",
    });
    assert(
      log.includes("chore(plan): archive PLAN-test.md"),
      "should commit the archive itself",
    );
  } finally {
    repo.cleanup();
  }

  console.log("  ✓ autoArchivePlan synthesizes missing header");
}

export function testAutoArchivePlanKeepsExistingHeader(): void {
  const repo = createTestRepo();
  try {
    writePlan(repo.dir, "> ✅ **shipped** (deadbee)\n\n# Test Plan\n\nDone.\n");

    const result = autoArchivePlan(repo.dir, ".fapony/plan/PLAN-test.md");
    assert.equal(result.ok, true, `should archive: ${result.error}`);

    const moved = readFileSync(archivedFile(repo.dir), "utf-8");
    assert.equal(
      (moved.match(/shipped/g) || []).length,
      1,
      "should not double-insert a header when one already exists",
    );
    assert(
      moved.includes("(deadbee)"),
      "should keep the original hash, not overwrite it",
    );
  } finally {
    repo.cleanup();
  }

  console.log("  ✓ autoArchivePlan keeps an existing header");
}

export function testAutoArchivePlanNormalizesLinks(): void {
  const repo = createTestRepo();
  try {
    writePlan(repo.dir, "# Test Plan\n\n[spec](spec/foo.md)\n");

    const result = autoArchivePlan(repo.dir, ".fapony/plan/PLAN-test.md");
    assert.equal(result.ok, true, `should archive: ${result.error}`);
    assert(
      result.normalizedLinks! >= 1,
      "should pass through planMv's link normalization, not swallow it",
    );

    const moved = readFileSync(archivedFile(repo.dir), "utf-8");
    assert(
      moved.includes("](../spec/foo.md)"),
      "link should be rewritten for its new depth under .fapony/plan/done/",
    );
  } finally {
    repo.cleanup();
  }

  console.log("  ✓ autoArchivePlan passes through planMv's link normalization");
}

export function testAutoArchivePlanMissingFile(): void {
  const repo = createTestRepo();
  try {
    const result = autoArchivePlan(repo.dir, ".fapony/plan/does-not-exist.md");
    assert.equal(result.ok, false, "missing plan file should fail, not throw");
    assert(
      result.error?.includes("shipped header"),
      `error should explain the failure: ${result.error}`,
    );
  } finally {
    repo.cleanup();
  }

  console.log("  ✓ autoArchivePlan missing file → ok:false, no throw");
}
