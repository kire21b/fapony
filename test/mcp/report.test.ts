// test/mcp/report.test.ts — tests for verification_report tool

import assert from "node:assert";
import { toolVerificationReport } from "../../src/mcp/tools/report.js";
import { parseToolResult } from "../../src/mcp/types.js";
import { withTmpDb } from "../helpers.js";

export function testVerificationReportMissingArgs(): void {
  const result = toolVerificationReport({});
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes(
      "provide run_id or worktree",
    ),
  );
  console.log("  ✓ verification_report requires run_id or worktree");
}

export function testVerificationReportRunNotFound(): void {
  withTmpDb(() => {
    const result = toolVerificationReport({ run_id: 999 });
    assert.ok(result.isError);
    assert.ok(
      (parseToolResult(result) as { error: string }).error.includes(
        "not found",
      ),
    );
    console.log("  ✓ verification_report returns error for missing run");
  });
}

export function testVerificationReportTextFormat(): void {
  withTmpDb(() => {
    // worktree that doesn't exist as git repo — facts will have git_error
    const result = toolVerificationReport({
      worktree: "/tmp",
      format: "text",
    });
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes("=== Verification Report ==="));
    assert.ok(text.includes("git facts"));
    assert.ok(text.includes("verdict: (not yet)"));
    console.log("  ✓ verification_report text format renders sections");
  });
}

export function testVerificationReportJsonFormat(): void {
  withTmpDb(() => {
    const result = toolVerificationReport({
      worktree: "/tmp",
      format: "json",
    });
    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: unknown;
      evidence: unknown[];
      meta: { source: string };
    };
    assert.ok(data.facts);
    assert.ok(Array.isArray(data.evidence));
    assert.equal(data.meta.source, "fapony_mcp");
    console.log("  ✓ verification_report json format returns structured data");
  });
}

export function testVerificationReportToolCount(): void {
  // Verify the tool is registered by checking tools/list includes it
  // (integration test — depends on transport.ts registration)
  const { TOOLS } =
    require("../../src/mcp/tools/index.js") as typeof import("../../src/mcp/tools/index.js");
  const names = TOOLS.map((t: { name: string }) => t.name);
  assert.ok(names.includes("verification_report"));
  assert.equal(TOOLS.length, 5);
  console.log("  ✓ verification_report registered in TOOLS (5 tools total)");
}
