import assert from "node:assert";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planMv } from "../src/planmv.js";

const DATED_NAME_RE = /^\d{4}-\d{2}-\d{2}-PLAN-test\.md$/;

function withTmpRepo(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-planmv-"));
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email 'test@test.com'", {
    cwd: dir,
    stdio: "ignore",
  });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
  mkdirSync(join(dir, ".fapony", "plan", "done"), { recursive: true });
  writeFileSync(
    join(dir, ".fapony", "plan", "placeholder.md"),
    "placeholder\n",
  );
  execSync("git add . && git commit -m 'init'", { cwd: dir, stdio: "ignore" });

  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testPlanMvNoHeader(): void {
  withTmpRepo((dir) => {
    const planPath = join(dir, ".fapony", "plan", "PLAN-test.md");
    writeFileSync(planPath, "# Test Plan\n\nSome content here.\n");

    const result = planMv(planPath, { repoRoot: dir });
    assert.equal(result.ok, false, "should fail without shipped header");
    assert(
      result.error?.includes("shipped"),
      "error should mention shipped header",
    );
  });

  console.log("  ✓ planMv no header");
}

export function testPlanMvWithHeader(): void {
  withTmpRepo((dir) => {
    const planPath = join(dir, ".fapony", "plan", "PLAN-test.md");
    writeFileSync(
      planPath,
      "> ✅ **shipped** (abc123)\n\n# Test Plan\n\nDone.\n",
    );
    execSync("git add .fapony/plan/PLAN-test.md && git commit -m 'add plan'", {
      cwd: dir,
      stdio: "ignore",
    });

    const result = planMv(planPath, { repoRoot: dir });
    assert.equal(result.ok, true, "should pass with shipped header");
    assert.equal(result.normalizedLinks, 0);
    assert(
      DATED_NAME_RE.test(result.destName!),
      `destName should be date-prefixed, got ${result.destName}`,
    );

    assert(
      !require("node:fs").existsSync(planPath),
      "old path should not exist",
    );
    assert(
      require("node:fs").existsSync(
        join(dir, ".fapony", "plan", "done", result.destName!),
      ),
      "should be in done/ under the dated name",
    );
  });

  console.log("  ✓ planMv with header");
}

export function testPlanMvNormalizeLinks(): void {
  withTmpRepo((dir) => {
    const planPath = join(dir, ".fapony", "plan", "PLAN-test.md");
    writeFileSync(
      planPath,
      "> ✅ **shipped** (abc123)\n\n# Plan\n\n[spec](spec/foo.md) [link](../README.md)\n",
    );
    execSync("git add .fapony/plan/PLAN-test.md && git commit -m 'add plan'", {
      cwd: dir,
      stdio: "ignore",
    });

    const result = planMv(planPath, { repoRoot: dir });
    assert.equal(result.ok, true);
    assert(result.normalizedLinks! >= 1, "should normalize at least 1 link");

    const moved = readFileSync(
      join(dir, ".fapony", "plan", "done", result.destName!),
      "utf-8",
    );
    // After moving .fapony/plan/PLAN.md → .fapony/plan/done/PLAN.md (1 level deeper):
    // spec/foo.md → ../spec/foo.md (up one, then into spec/)
    // ../README.md → ../../README.md (up two from done/)
    assert(
      moved.includes("](../spec/foo.md)"),
      "spec link should be ../spec/foo.md from done/",
    );
    assert(
      moved.includes("](../../README.md)"),
      "root link should be ../../README.md from done/",
    );
  });

  console.log("  ✓ planMv normalize links");
}

export function testPlanMvDryRun(): void {
  withTmpRepo((dir) => {
    const planPath = join(dir, ".fapony", "plan", "PLAN-test.md");
    writeFileSync(planPath, "> ✅ **shipped** (abc123)\n\n# Plan\n\nDone.\n");
    execSync("git add .fapony/plan/PLAN-test.md && git commit -m 'add plan'", {
      cwd: dir,
      stdio: "ignore",
    });

    const result = planMv(planPath, { repoRoot: dir, dryRun: true });
    assert.equal(result.ok, true);
    assert(
      require("node:fs").existsSync(planPath),
      "file should still exist in dry run",
    );
  });

  console.log("  ✓ planMv dry run");
}

export function testPlanMvAlreadyDatedNotDoublePrefixed(): void {
  withTmpRepo((dir) => {
    const planPath = join(dir, ".fapony", "plan", "2020-01-01-PLAN-test.md");
    writeFileSync(planPath, "> ✅ **shipped** (abc123)\n\n# Plan\n\nDone.\n");
    execSync("git add . && git commit -m 'add plan'", {
      cwd: dir,
      stdio: "ignore",
    });

    const result = planMv(planPath, { repoRoot: dir });
    assert.equal(result.ok, true);
    assert.equal(
      result.destName,
      "2020-01-01-PLAN-test.md",
      "should not stack a second date prefix",
    );

    const files = readdirSync(join(dir, ".fapony", "plan", "done"));
    assert(files.includes("2020-01-01-PLAN-test.md"));
  });

  console.log("  ✓ planMv already-dated filename not double-prefixed");
}

export function testPlanMvMissingFile(): void {
  withTmpRepo((dir) => {
    const result = planMv(join(dir, ".fapony", "plan", "PLAN-nope.md"), {
      repoRoot: dir,
    });
    assert.equal(result.ok, false, "missing file must return ok:false, not throw");
    assert(
      result.error?.includes("cannot read"),
      `error should mention unreadable file, got: ${result.error}`,
    );
  });

  console.log("  ✓ planMv missing file returns error");
}

export function testPlanMvDestCollision(): void {
  withTmpRepo((dir) => {
    const planPath = join(dir, ".fapony", "plan", "2020-01-01-PLAN-test.md");
    const ship = "> ✅ **shipped** (abc123)\n\n# Plan\n\nDone.\n";
    writeFileSync(planPath, ship);
    execSync("git add . && git commit -m 'add plan'", {
      cwd: dir,
      stdio: "ignore",
    });

    const first = planMv(planPath, { repoRoot: dir });
    assert.equal(first.ok, true, "first archive should succeed");

    // Recreate the same source (e.g. re-run after a partial failure) —
    // the dated dest already exists, so this must fail gracefully.
    writeFileSync(planPath, ship);
    execSync("git add . && git commit -m 're-add plan'", {
      cwd: dir,
      stdio: "ignore",
    });
    const second = planMv(planPath, { repoRoot: dir });
    assert.equal(second.ok, false, "second archive must return ok:false, not throw");
    assert(
      second.error?.includes("already exists"),
      `error should mention existing destination, got: ${second.error}`,
    );
  });

  console.log("  ✓ planMv dest collision returns error");
}
