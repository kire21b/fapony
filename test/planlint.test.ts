import assert from "node:assert";
import { checkPlanHygiene } from "../src/planlint.js";

export function testPlanHygieneOk(): void {
  const plan = `> **Source spec:** [spec/x.md](../spec/x.md)\n\n## 7. Examples\nSee spec.\n\n## 8. References\n- link\n`;
  const warnings = checkPlanHygiene(plan);
  assert.equal(
    warnings.length,
    0,
    "short plan with linked spec should have no warnings",
  );
  console.log("  ✓ checkPlanHygiene (clean plan)");
}

export function testPlanHygieneTooLong(): void {
  const plan = "line\n".repeat(250);
  const warnings = checkPlanHygiene(plan);
  assert(
    warnings.some((w) => w.kind === "too_long"),
    "plan over the line cap should warn too_long",
  );
  console.log("  ✓ checkPlanHygiene (too long)");
}

export function testPlanHygieneSpecLeak(): void {
  const bulk = Array.from({ length: 10 }, (_, i) => `example ${i}`).join("\n");
  const plan = `> **Source spec:** [spec/x.md](../spec/x.md)\n\n## 7. Examples\n${bulk}\n\n## 8. References\n- link\n`;
  const warnings = checkPlanHygiene(plan);
  assert(
    warnings.some((w) => w.kind === "spec_leak"),
    "bulky section 7 with a linked spec should warn spec_leak",
  );
  console.log("  ✓ checkPlanHygiene (spec leak)");
}

export function testPlanHygieneNoSpecNoLeakWarning(): void {
  const bulk = Array.from({ length: 10 }, (_, i) => `example ${i}`).join("\n");
  const plan = `> **Source spec:** ไม่มี\n\n## 7. Examples\n${bulk}\n\n## 8. References\n- link\n`;
  const warnings = checkPlanHygiene(plan);
  assert(
    !warnings.some((w) => w.kind === "spec_leak"),
    "no spec linked means bulky examples are fine — nothing to leak from",
  );
  console.log("  ✓ checkPlanHygiene (no spec, no leak warning)");
}

export function testPlanHygieneEnglishNoneNoLeak(): void {
  const bulk = Array.from({ length: 10 }, (_, i) => `example ${i}`).join("\n");
  for (const sentinel of ["none", "n/a", "no spec", "—"]) {
    const plan = `> **Source spec:** ${sentinel}\n\n## 7. Examples\n${bulk}\n\n## 8. References\n- link\n`;
    const warnings = checkPlanHygiene(plan);
    assert(
      !warnings.some((w) => w.kind === "spec_leak"),
      `"${sentinel}" means no spec linked — must not warn spec_leak`,
    );
  }
  console.log("  ✓ checkPlanHygiene (english no-spec sentinels)");
}

export function testPlanHygieneHeadingVariant(): void {
  const bulk = Array.from({ length: 10 }, (_, i) => `example ${i}`).join("\n");
  for (const heading of [
    "## 7: Examples",
    "## 7 — Examples",
    "## 7 Examples",
  ]) {
    const plan = `> **Source spec:** [spec/x.md](../spec/x.md)\n\n${heading}\n${bulk}\n\n## 8. References\n- link\n`;
    const warnings = checkPlanHygiene(plan);
    assert(
      warnings.some((w) => w.kind === "spec_leak"),
      `"${heading}" with a linked spec should still warn spec_leak`,
    );
  }
  console.log("  ✓ checkPlanHygiene (section 7 heading variants)");
}
