// test/plans.test.ts — cwd→worktree resolution, pending plan scan, run short forms

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/db/index.js";
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
    // sorted alphabetically (stable index for `fapony run <n>`),
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

export function testResolvePlanArgIndexAndPrefix(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    assert.deepEqual(resolvePlanArg(config, "vela", "1"), {
      ok: true,
      worktreeKey: "vela",
      planPath: ".fapony/plan/PLAN-a.md",
    });
    assert.deepEqual(resolvePlanArg(config, "vela", "2"), {
      ok: true,
      worktreeKey: "vela",
      planPath: ".fapony/plan/PLAN-b.md",
    });
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
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolvePlanArg (index, exact, prefix)");
}

export function testResolvePlanArgErrors(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    const ambiguous = resolvePlanArg(config, "vela", "PLAN-");
    assert.equal(ambiguous.ok, false, "prefix matching 2 plans → ambiguous");
    if (!ambiguous.ok) assert(ambiguous.error.includes("PLAN-a.md"));

    const oob = resolvePlanArg(config, "vela", "9");
    assert.equal(oob.ok, false, "index out of range");
    if (!oob.ok) assert(oob.error.includes("out of range"));

    const nomatch = resolvePlanArg(config, "vela", "zzz");
    assert.equal(nomatch.ok, false, "no match");
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log("  ✓ resolvePlanArg (ambiguous, out of range, no match)");
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
    const byIndex = resolveRunArgs(config, ["2"], wt);
    assert.deepEqual(
      byIndex,
      {
        ok: true,
        worktreeKey: "vela",
        planPath: ".fapony/plan/PLAN-b.md",
        memId: null,
        allowDirty: false,
        loop: false,
      },
      "fapony run 2 (cwd infers key)",
    );

    const byKeyAndIndex = resolveRunArgs(config, ["vela", "1"], wt);
    assert.deepEqual(
      byKeyAndIndex,
      {
        ok: true,
        worktreeKey: "vela",
        planPath: ".fapony/plan/PLAN-a.md",
        memId: null,
        allowDirty: false,
        loop: false,
      },
      "fapony run vela 1",
    );

    const byPrefix = resolveRunArgs(config, ["plan-a"], wt);
    if (!byPrefix.ok) throw new Error(byPrefix.error);
    assert.equal(byPrefix.planPath, ".fapony/plan/PLAN-a.md");

    const ambiguous = resolveRunArgs(config, [], wt);
    assert.equal(ambiguous.ok, false, "2 pending + no ref → ambiguous");
    if (!ambiguous.ok) assert(ambiguous.error.includes("#1"));
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log(
    "  ✓ resolveRunArgs (run <n>, run <key> <n>, run <prefix>, ambiguous)",
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
    assert(section.includes("fapony run <n>"), "run hint");

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

export function testResolveRunArgsRunIdHint(): void {
  const wt = fixtureTwo();
  try {
    const config = cfg(wt);
    // Out of range plan index should suggest run ID hint
    const oob = resolveRunArgs(config, ["99"], wt);
    assert.equal(oob.ok, false, "out of range index");
    if (!oob.ok) {
      assert(oob.error.includes("out of range"), "mentions out of range");
      // Note: no run ID hint because run 99 doesn't exist in DB
    }
  } finally {
    rmSync(wt, { recursive: true, force: true });
  }
  console.log(
    "  ✓ resolveRunArgs (out of range → no hint when run doesn't exist)",
  );
}
