import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPPED_RE } from "../src/planmv.js";

// We can't easily test cmdKickoff (it calls runOnce which needs git + executor),
// but we can test the core logic: shipped regex filtering + pending detection.

function getPendingPlans(planDir: string): string[] {
  const { readdirSync, readFileSync } = require("node:fs");
  const pending: string[] = [];
  try {
    const entries = readdirSync(planDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (entry.name === "done") continue;
      const content = readFileSync(join(planDir, entry.name), "utf-8");
      if (!SHIPPED_RE.test(content)) {
        pending.push(entry.name);
      }
    }
  } catch {}
  return pending;
}

export function testKickoffSinglePending(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-kickoff-"));
  try {
    const planDir = join(dir, ".fapony", "plan");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, "PLAN-alpha.md"),
      "# Plan Alpha\n\nDo stuff.\n",
    );

    const pending = getPendingPlans(planDir);
    assert.deepEqual(pending, ["PLAN-alpha.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ kickoff single pending detected");
}

export function testKickoffShippedFiltered(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-kickoff-"));
  try {
    const planDir = join(dir, ".fapony", "plan");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, "PLAN-done.md"),
      "> ✅ **shipped** (abc123)\n\n# Done Plan\n",
    );
    writeFileSync(join(planDir, "PLAN-active.md"), "# Active Plan\n\nWIP.\n");

    const pending = getPendingPlans(planDir);
    assert.deepEqual(pending, ["PLAN-active.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ kickoff shipped plans filtered");
}

export function testKickoffMultiplePending(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-kickoff-"));
  try {
    const planDir = join(dir, ".fapony", "plan");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, "PLAN-a.md"), "# Plan A\n");
    writeFileSync(join(planDir, "PLAN-b.md"), "# Plan B\n");

    const pending = getPendingPlans(planDir);
    assert.equal(pending.length, 2, "should detect 2 pending plans");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ kickoff multiple pending detected");
}

export function testKickoffNoPending(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-kickoff-"));
  try {
    const planDir = join(dir, ".fapony", "plan");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, "PLAN-done.md"),
      "> ✅ **shipped** (abc123)\n\n# Done.\n",
    );

    const pending = getPendingPlans(planDir);
    assert.equal(pending.length, 0, "should find 0 pending plans");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ kickoff no pending found");
}
