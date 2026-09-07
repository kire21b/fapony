// test/plans.test.ts — cwd→worktree resolution, pending plan scan, run short forms

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, newRun, openDb, setStatus } from "../src/db/index.js";
import { pendingPlans, resolvePlanArg, worktreeFromCwd } from "../src/plans.js";
import { resolveRunArgs } from "../src/run/cli.js";
import { renderPendingPlans } from "../src/status.js";

const SHIPPED = "> ✅ **shipped** (abc123)";

/** Worktree with .fapony/plan: PLAN-a, PLAN-b pending; shipped + done/ excluded. */
function fixtureTwo(): string {
  const wt = mkdtempSync(join(tmpdir(), "fapony-plans-"));
  const planDir = join(wt, ".fapony", "plan");
  mkdirSync(join(planDir, "done"), { recursive: true });
  writeFileSync(join(planDir, "PLAN-b.md"), "# B\n");
  writeFileSync(join(planDir, "PLAN-a.md"), "# A\n");
  writeFileSync(join(planDir, "PLAN-old.md"), `${SHIPPED}\n\n# old\n`);
  writeFileSync(join(planDir, "done", "PLAN-x.md"), "# x\n");
  return wt;
}

function fixtureOne(): string {
  const wt = mkdtempSync(join(tmpdir(), "fapony-plans1-"));
  const planDir = join(wt, ".fapony", "plan");
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, "PLAN-solo.md"), "# solo\n");
  return wt;
}

function cfg(wt: string) {
  return {
    ...loadConfig("/nonexistent/fapony.config.json"),
    worktrees: { vela: wt },
  };
}

export function testWorktreeFromCwd(): void {
  const wt = mkdtempSync(join(tmpdir(), "fapony-cwd-"));
  try {
    const config = cfg(wt);
    assert.equal(worktreeFromCwd(config, wt), "vela", "cwd = worktree root");
    assert.equal(
      worktreeFromCwd(config, join(wt, "src", "deep")),
      "vela",
      "cwd inside worktree subtree",
    );
    assert.equal(
      worktreeFromCwd(config, tmpdir()),
      null,
      "cwd outside every worktree",
    );
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ worktreeFromCwd (root, subtree, outside)");
}

export function testPendingPlansFilteredAndSorted(): void {
  const wt = fixtureTwo();
  try {
    // sorted alphabetically (stable numbering for the `fapony ps` display),
    // shipped header excluded, done/ excluded
    assert.deepEqual(pendingPlans(cfg(wt), wt), ["PLAN-a.md", "PLAN-b.md"]);
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ pendingPlans (sorted, shipped + done/ filtered)");
}

export function testPendingPlansMissingDir(): void {
  const wt = mkdtempSync(join(tmpdir(), "fapony-plans0-"));
  try {
    assert.deepEqual(pendingPlans(cfg(wt), wt), [], "no .fapony/plan → empty");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ pendingPlans (missing plan dir → empty)");
}

export function testResolvePlanArgExactAndPrefix(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    assert.deepEqual(
      resolvePlanArg(config, "vela", "PLAN-b.md"),
      { ok: true, worktreeKey: "vela", planPath: ".fapony/plan/PLAN-b.md" },
      "exact filename",
    );
    assert.deepEqual(
      resolvePlanArg(config, "vela", "plan-b"),
      { ok: true, worktreeKey: "vela", planPath: ".fapony/plan/PLAN-b.md" },
      "case-insensitive prefix",
    );
    // A digit is never a plan index anymore — resolveRunArgs treats it as a
    // run ID before resolvePlanArg is even called, but resolvePlanArg itself
    // still just does a plain (non-matching) prefix lookup for one.
    const digit = resolvePlanArg(config, "vela", "1");
    assert.equal(digit.ok, false, "digit is not a plan index");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolvePlanArg (exact, prefix, digit is not an index)");
}

export function testResolvePlanArgErrors(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    const ambiguous = resolvePlanArg(config, "vela", "PLAN-");
    assert.equal(ambiguous.ok, false, "prefix matching 2 plans → ambiguous");
    if (!ambiguous.ok) assert(ambiguous.error.includes("PLAN-a.md"));

    const nomatch = resolvePlanArg(config, "vela", "zzz");
    assert.equal(nomatch.ok, false, "no match");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolvePlanArg (ambiguous, no match)");
}

export function testResolveRunArgsFullForm(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    const full = resolveRunArgs(config, [
      "vela",
      "--plan",
      ".fapony/plan/PLAN-b.md",
      "--mem-id",
      "m1",
      "--allow-dirty",
    ]);
    assert.deepEqual(full, {
      ok: true,
      worktreeKey: "vela",
      planPath: ".fapony/plan/PLAN-b.md",
      memId: "m1",
      allowDirty: true,
      loop: false,
    });

    const missing = resolveRunArgs(config, [
      "vela",
      "--plan",
      ".fapony/plan/PLAN-nope.md",
    ]);
    assert.equal(missing.ok, false, "--plan file must exist");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolveRunArgs (full form + flags, missing --plan errors)");
}

export function testResolveRunArgsShortForms(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    const byPrefix = resolveRunArgs(config, ["plan-a"], wt);
    if (!byPrefix.ok) throw new Error(byPrefix.error);
    assert.equal(byPrefix.planPath, ".fapony/plan/PLAN-a.md");

    const byKeyAndPrefix = resolveRunArgs(config, ["vela", "plan-b"], wt);
    assert.deepEqual(
      byKeyAndPrefix,
      {
        ok: true,
        worktreeKey: "vela",
        planPath: ".fapony/plan/PLAN-b.md",
        memId: null,
        allowDirty: false,
        loop: false,
      },
      "fapony run vela plan-b",
    );

    const ambiguous = resolveRunArgs(config, [], wt);
    assert.equal(ambiguous.ok, false, "2 pending + no ref → ambiguous");
    if (!ambiguous.ok) assert(ambiguous.error.includes("#1"));
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log(
    "  ✓ resolveRunArgs (run <prefix>, run <key> <prefix>, ambiguous)",
  );
}

export function testResolveRunArgsAutoSingle(): void {
  const wt = fixtureOne();
  try {
    const config = cfg(wt);
    const solo = resolveRunArgs(config, [], wt);
    if (!solo.ok) throw new Error(solo.error);
    assert.equal(solo.planPath, ".fapony/plan/PLAN-solo.md");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolveRunArgs (1 pending → auto-pick)");
}

export function testResolveRunArgsErrors(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    const noCwd = resolveRunArgs(config, []);
    assert.equal(noCwd.ok, false, "no key, no cwd → usage error");

    const unknown = resolveRunArgs(config, ["nope"]);
    assert.equal(unknown.ok, false, "unknown key + no cwd → error");
    if (!unknown.ok) assert(unknown.error.includes("unknown worktree key"));

    const pathRef = resolveRunArgs(config, [".fapony/plan/PLAN-a.md"], wt);
    assert.equal(pathRef.ok, false, "path-shaped ref rejected (use --plan)");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolveRunArgs (no cwd, unknown key, path ref)");
}

export function testRenderPendingPlansSection(): void {
  const wt = fixtureTwo();
  try {
    const section = renderPendingPlans(cfg(wt), "vela");
    assert(section.includes("pending plans (vela)"), "header with key");
    assert(section.includes("#1 PLAN-a.md"), "numbered entries");
    assert(section.includes("fapony run <plan-prefix>"), "run hint");
    assert(section.includes("fapony run PLAN-a.md"), "run example");

    const empty = mkdtempSync(join(tmpdir(), "fapony-plans-none-"));
    try {
      assert.equal(renderPendingPlans(cfg(empty), "vela"), "");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ renderPendingPlans (numbered section, empty → '')");
}

export function testResolveRunArgsLoopFlag(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    const withLoop = resolveRunArgs(config, [
      "vela",
      "--plan",
      ".fapony/plan/PLAN-a.md",
      "--loop",
    ]);
    if (!withLoop.ok) throw new Error(withLoop.error);
    assert.equal(withLoop.loop, true, "--loop flag parsed");

    const withoutLoop = resolveRunArgs(config, [
      "vela",
      "--plan",
      ".fapony/plan/PLAN-a.md",
    ]);
    if (!withoutLoop.ok) throw new Error(withoutLoop.error);
    assert.equal(withoutLoop.loop, false, "no --loop flag");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolveRunArgs (--loop flag)");
}

export function testResolveRunArgsDigitNotFound(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    // A bare digit is always treated as a run ID — never falls back to
    // plan-index guessing, even when a plan with that "index" exists.
    const missing = resolveRunArgs(config, ["99"], wt);
    assert.equal(missing.ok, false, "no run 99 in DB");
    if (!missing.ok) assert(missing.error.includes("not found"));
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolveRunArgs (digit with no matching run → not found)");
}

function withTmpDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "fapony-run-resume-"));
  const orig = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = dir;
  try {
    const db = openDb();
    const result = fn(db);
    db.close();
    return result;
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testResolveRunArgsResumeRunId(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);

    withTmpDb((db) => {
      // fixtureTwo has 2 pending plans (indices 1,2). newRun returns IDs starting at 1.
      // Create 2 dummy runs first to push the real run IDs past the plan range.
      newRun(db, "vela", null, null, "x1");
      newRun(db, "vela", null, null, "x2");

      // Run in awaiting_review — ID will be 3, past plan range (only 2 plans)
      const runId = newRun(
        db,
        "vela",
        ".fapony/plan/PLAN-a.md",
        "mem-1",
        "abc",
      );
      setStatus(db, runId, "awaiting_review");

      const res = resolveRunArgs(config, [String(runId)], wt);
      assert.equal(res.ok, true, "awaiting_review run resumes via run ID");
      if (res.ok) {
        assert.equal(res.runId, runId, "runId returned");
        assert.equal(res.planPath, ".fapony/plan/PLAN-a.md", "plan preserved");
        assert.equal(res.memId, "mem-1", "mem_id preserved");
      }

      // Run in fixing
      const runId2 = newRun(db, "vela", ".fapony/plan/PLAN-b.md", null, "def");
      setStatus(db, runId2, "fixing");

      const res2 = resolveRunArgs(config, [String(runId2)], wt);
      assert.equal(res2.ok, true, "fixing run resumes via run ID");
      if (res2.ok) {
        assert.equal(res2.runId, runId2);
      }

      // Run in passed — NOT resumable
      const runId3 = newRun(db, "vela", null, null, "aaa");
      setStatus(db, runId3, "passed");

      const res3 = resolveRunArgs(config, [String(runId3)], wt);
      assert.equal(res3.ok, false, "passed run does not resume");
      if (!res3.ok) {
        assert(res3.error.includes("passed"), "mentions passed status");
      }
    });

    // With --loop flag: loop should be carried through
    withTmpDb((db) => {
      newRun(db, "vela", null, null, "x1");
      newRun(db, "vela", null, null, "x2");
      const runId = newRun(db, "vela", ".fapony/plan/PLAN-a.md", null, "abc");
      setStatus(db, runId, "fixing");

      const res = resolveRunArgs(config, [String(runId), "--loop"], wt);
      assert.equal(res.ok, true, "fixing + --loop resumes");
      if (res.ok) {
        assert.equal(res.loop, true, "loop flag preserved");
        assert.equal(res.runId, runId);
      }
    });
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log(
    "  ✓ resolveRunArgs (run ID resume: awaiting_review, fixing, passed skip, --loop)",
  );
}
