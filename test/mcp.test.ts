import assert from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newRun, openDb } from "../src/db/index.js";
import {
  dispatch,
  errorResult,
  extractMultiField,
  jsonResult,
  parseToolResult,
  REASON_CODES,
  toolHandoffCheck,
  toolHandoffCollect,
  toolVerdictSubmit,
} from "../src/mcp.js";

// --- helpers ---

function withTempRepo(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mcp-test-"));
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email 'test@test.com'", {
    cwd: dir,
    stdio: "ignore",
  });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "a.txt"), "initial\n");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync("git commit -m 'initial'", { cwd: dir, stdio: "ignore" });
  fn(dir);
}

// --- tests ---

export function testMcpToolsList(): void {
  const result = dispatch("tools/list", {});
  assert.ok(result && typeof result === "object");
  const r = result as { tools: { name: string }[] };
  assert.equal(r.tools.length, 3);
  assert.equal(r.tools[0].name, "handoff_collect");
  assert.equal(r.tools[1].name, "handoff_check");
  assert.equal(r.tools[2].name, "verdict_submit");
  console.log("  ✓ mcp tools/list returns 3 tools");
}

export function testMcpInitialize(): void {
  const result = dispatch("initialize", {});
  assert.ok(result && typeof result === "object");
  const r = result as { protocolVersion: string; serverInfo: { name: string } };
  assert.equal(r.protocolVersion, "2025-03-26");
  assert.equal(r.serverInfo.name, "fapony-handcheck");
  console.log("  ✓ mcp initialize returns protocol version");
}

export function testMcpNotificationsIgnored(): void {
  const result = dispatch("notifications/initialized", {});
  assert.equal(result, null);
  console.log("  ✓ mcp notifications/initialized returns null");
}

export function testMcpUnknownMethod(): void {
  const result = dispatch("foo/bar", {});
  assert.ok(result && typeof result === "object" && "code" in result);
  assert.equal((result as { code: number }).code, -32601);
  console.log("  ✓ mcp unknown method returns error");
}

export function testMcpToolsCallUnknownTool(): void {
  const result = dispatch("tools/call", {
    name: "nonexistent",
    arguments: {},
  });
  assert.ok(result && "isError" in result);
  assert.equal((result as { isError: boolean }).isError, true);
  console.log("  ✓ mcp tools/call unknown tool returns error");
}

export function testHandoffCollectMissingArgs(): void {
  const result = toolHandoffCollect({});
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("worktree"),
  );
  console.log("  ✓ handoff_collect missing worktree returns error");
}

export function testHandoffCollectAutoDetectRange(): void {
  withTempRepo((dir) => {
    // Create a second commit
    writeFileSync(join(dir, "b.txt"), "new content\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync("git commit -m 'add b.txt'", { cwd: dir, stdio: "ignore" });

    // Call without base_sha/head_sha — should auto-detect HEAD~1..HEAD
    const result = toolHandoffCollect({ worktree: dir });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: { files_changed: number; commits: string[] };
    };
    assert.equal(data.facts.files_changed, 1);
    assert.equal(data.facts.commits.length, 1);
  });
  console.log(
    "  ✓ handoff_collect auto-detects commit range from recent commits",
  );
}

export function testHandoffCollectValidRepo(): void {
  withTempRepo((dir) => {
    // Create a second commit
    writeFileSync(join(dir, "b.txt"), "new content\n");
    execSync("git add .", { cwd: dir, stdio: "ignore" });
    execSync("git commit -m 'add b.txt'", { cwd: dir, stdio: "ignore" });

    const baseSha = execSync("git rev-parse HEAD~1", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    const headSha = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();

    const result = toolHandoffCollect({
      base_sha: baseSha,
      head_sha: headSha,
      worktree: dir,
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      facts: { files_changed: number; commits: string[]; branch: string };
      provenance: { verified: boolean; source: string };
    };
    assert.equal(data.facts.files_changed, 1);
    assert.equal(data.facts.commits.length, 1);
    assert.equal(data.provenance.verified, true);
    assert.equal(data.provenance.source, "git_cli");
  });
  console.log("  ✓ handoff_collect returns verified facts from real repo");
}

export function testHandoffCollectGitError(): void {
  // Without base_sha/head_sha on a non-git-dir: auto-detect fails
  const result = toolHandoffCollect({ worktree: "/tmp" });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes(
      "cannot auto-detect",
    ),
  );
  console.log(
    "  ✓ handoff_collect auto-detect fails gracefully on non-git dir",
  );
}

export function testHandoffCollectExplicitRange(): void {
  withTempRepo((dir) => {
    // Create 3 commits
    writeFileSync(join(dir, "a.txt"), "a\n");
    execSync("git add . && git commit -m 'a'", { cwd: dir, stdio: "ignore" });
    writeFileSync(join(dir, "b.txt"), "b\n");
    execSync("git add . && git commit -m 'b'", { cwd: dir, stdio: "ignore" });

    const baseSha = execSync("git rev-parse HEAD~1", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
    const headSha = execSync("git rev-parse HEAD", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();

    // Explicit range should still work
    const result = toolHandoffCollect({
      base_sha: baseSha,
      head_sha: headSha,
      worktree: dir,
    });

    const data = parseToolResult(result) as {
      facts: { commits: string[] };
    };
    assert.equal(data.facts.commits.length, 1);
  });
  console.log("  ✓ handoff_collect with explicit range still works");
}

export function testHandoffCheckMissingBlock(): void {
  const result = toolHandoffCheck({ handoff: "no handoff here" });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { total: number; failed: number };
  };
  assert.equal(data.checks.length, 1);
  assert.equal(data.checks[0].name, "has_handoff_block");
  assert.equal(data.checks[0].pass, false);
  assert.equal(data.summary.failed, 1);
  console.log("  ✓ handoff_check detects missing block");
}

export function testHandoffCheckGoodHandoff(): void {
  const handoff = [
    "Some output",
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123 def456",
    "checks: typecheck pass",
    "uncertain: none",
    "not_done: none",
  ].join("\n");

  const facts = { commits: ["abc123", "def456"] };
  // Agent-reported fields provided as separate args
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "none",
    not_done: "none",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { total: number; passed: number; failed: number };
  };
  assert.equal(data.summary.total, 6);
  assert.equal(data.summary.passed, 6);
  assert.equal(data.summary.failed, 0);
  console.log("  ✓ handoff_check passes for good handoff");
}

export function testHandoffCheckUncertainFails(): void {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: typecheck pass",
    "uncertain: auth flow might need refactoring",
    "not_done: none",
  ].join("\n");

  const facts = { commits: ["abc123"] };
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "auth flow might need refactoring",
    not_done: "none",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { failed: number };
  };
  const uncertainCheck = data.checks.find(
    (c) => c.name === "uncertain_not_empty",
  );
  assert.equal(uncertainCheck?.pass, false);
  assert.equal(data.summary.failed, 1);
  console.log("  ✓ handoff_check fails when uncertainty reported");
}

export function testHandoffCheckNotDoneFails(): void {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: typecheck pass",
    "uncertain: none",
    "not_done: tests",
  ].join("\n");

  const facts = { commits: ["abc123"] };
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "none",
    not_done: "tests",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
  };
  const notDoneCheck = data.checks.find((c) => c.name === "not_done_not_empty");
  assert.equal(notDoneCheck?.pass, false);
  console.log("  ✓ handoff_check fails when not_done reported");
}

export function testHandoffCheckWithFactsCrossRef(): void {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123 def456",
    "checks: pass",
    "uncertain: none",
    "not_done: none",
  ].join("\n");

  const facts = { commits: ["abc123", "def456"] };
  const result = toolHandoffCheck({
    handoff,
    facts,
    uncertain: "none",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
  };
  const crossRef = data.checks.find((c) => c.name === "facts_cross_referenced");
  assert.equal(crossRef?.pass, true);
  console.log("  ✓ handoff_check cross-references facts");
}

export function testHandoffCheckWithoutFacts(): void {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: pass",
    "uncertain: none",
    "not_done: none",
  ].join("\n");

  const result = toolHandoffCheck({
    handoff,
    uncertain: "none",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean; note: string }[];
  };
  const crossRef = data.checks.find((c) => c.name === "facts_cross_referenced");
  // When no facts provided, the check is skipped entirely (not in checks array)
  assert.equal(crossRef, undefined);
  console.log("  ✓ handoff_check skips facts_cross_referenced when no facts");
}

export function testHandoffCheckAutoGenerate(): void {
  const facts = { commits: ["abc123", "def456"] };
  // Agent provides uncertain/not_done/checks → used in handoff
  const result = toolHandoffCheck({
    auto_generate: true,
    facts,
    uncertain: "none",
    not_done: "none",
    checks: "typecheck pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { total: number; failed: number };
  };
  // All checks pass because agent reported them
  assert.equal(data.summary.failed, 0);
  console.log(
    "  ✓ handoff_check auto-generates claimed/commits, uses agent uncertain/not_done/checks",
  );
}

export function testHandoffCheckAutoGenerateRequiresAgentReport(): void {
  const facts = { commits: ["abc123", "def456"] };
  // Agent does NOT provide uncertain/not_done/checks → all 3 fail
  const result = toolHandoffCheck({ auto_generate: true, facts });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean; note: string }[];
    summary: { failed: number };
  };
  // uncertain_not_empty fails, not_done_not_empty fails, checks_declared fails
  assert.ok(data.summary.failed >= 3);
  const checksDecl = data.checks.find((c) => c.name === "checks_declared");
  assert.equal(checksDecl?.pass, false);
  assert.ok(checksDecl?.note.includes("did not report"));
  console.log(
    "  ✓ handoff_check auto_generate without agent report fails all 3 checks",
  );
}

export function testHandoffCheckAutoGenerateWithUncertainty(): void {
  const facts = { commits: ["abc123"] };
  // Agent reports uncertainty → uncertain_not_empty fails
  const result = toolHandoffCheck({
    auto_generate: true,
    facts,
    uncertain: "auth flow might need refactoring",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean }[];
    summary: { failed: number };
  };
  assert.equal(data.summary.failed, 1); // only uncertain fails
  console.log(
    "  ✓ handoff_check auto_generate catches agent-reported uncertainty",
  );
}

export function testHandoffCheckMultiLineUncertain(): void {
  const handoff = [
    "## HANDOFF",
    "claimed: abc123",
    "commits: abc123",
    "checks: pass",
    "uncertain: first issue",
    "  also second issue",
    "not_done: none",
  ].join("\n");

  const result = toolHandoffCheck({
    handoff,
    uncertain: "first issue\n  also second issue",
    not_done: "none",
    checks: "pass",
  });
  const data = parseToolResult(result) as {
    checks: { name: string; pass: boolean; note: string }[];
  };
  const uncertainCheck = data.checks.find(
    (c) => c.name === "uncertain_not_empty",
  );
  assert.equal(uncertainCheck?.pass, false);
  assert.ok(uncertainCheck?.note.includes("first issue"));
  assert.ok(uncertainCheck?.note.includes("also second issue"));
  console.log("  ✓ handoff_check handles multi-line uncertain");
}

export function testVerdictSubmitInvalidVerdict(): void {
  const result = toolVerdictSubmit({
    verdict: "maybe",
    reason_code: "missing_test",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("verdict"),
  );
  console.log("  ✓ verdict_submit rejects invalid verdict");
}

export function testVerdictSubmitInvalidReasonCode(): void {
  const result = toolVerdictSubmit({
    verdict: "pass",
    reason_code: "bogus",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes(
      "reason_code",
    ),
  );
  console.log("  ✓ verdict_submit rejects invalid reason_code");
}

export function testVerdictSubmitOtherRequiresNote(): void {
  const result = toolVerdictSubmit({
    verdict: "fail",
    reason_code: "other",
  });
  assert.ok(result.isError);
  assert.ok(
    (parseToolResult(result) as { error: string }).error.includes("note"),
  );
  console.log("  ✓ verdict_submit requires note for reason_code=other");
}

export function testVerdictSubmitRunNotFound(): void {
  const result = toolVerdictSubmit({
    run_id: 99999,
    verdict: "pass",
    reason_code: "missing_test",
  });
  const data = parseToolResult(result) as { stored: boolean; error: string };
  assert.equal(data.stored, false);
  assert.equal(data.error, "run not found");
  console.log("  ✓ verdict_submit returns error for missing run");
}

export function testVerdictSubmitSuccess(): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-verdict-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    const db = openDb();
    const runId = newRun(db, "/tmp/test", null, null, "abc123");

    const result = toolVerdictSubmit({
      run_id: runId,
      verdict: "fail",
      reason_code: "missing_test",
      note: "needs integration test",
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      stored: boolean;
      event_id: number;
      run_id: number;
      verdict: string;
      reason_code: string;
    };
    assert.equal(data.stored, true);
    assert.equal(data.run_id, runId);
    assert.equal(data.verdict, "fail");
    assert.equal(data.reason_code, "missing_test");
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
  console.log("  ✓ verdict_submit stores event successfully");
}

export function testVerdictSubmitAutoCreatesRun(): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-autocreate-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    // Call without run_id — should auto-create a run
    const result = toolVerdictSubmit({
      verdict: "pass",
      reason_code: "missing_test",
    });

    assert.equal(result.isError, undefined);
    const data = parseToolResult(result) as {
      stored: boolean;
      run_id: number;
      verdict: string;
      reason_code: string;
    };
    assert.equal(data.stored, true);
    assert.ok(data.run_id > 0);
    assert.equal(data.verdict, "pass");
    assert.equal(data.reason_code, "missing_test");
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
  console.log("  ✓ verdict_submit auto-creates run when run_id omitted");
}

export function testVerdictSubmitStoresMcpSource(): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-src-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    const db = openDb();
    const runId = newRun(db, "/tmp/test", null, null, "abc123");

    toolVerdictSubmit({
      run_id: runId,
      verdict: "pass",
      reason_code: "missing_test",
    });

    // Read back the event
    const events = db
      .prepare("SELECT data FROM events WHERE run_id = ? AND kind = 'gate'")
      .all(runId) as { data: string }[];
    assert.equal(events.length, 1);
    const parsed = JSON.parse(events[0].data) as {
      source: string;
      verdict: string;
    };
    assert.equal(parsed.source, "mcp");
    assert.equal(parsed.verdict, "pass");
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
  console.log("  ✓ verdict_submit marks event with source=mcp");
}

export function testExtractMultiFieldNone(): void {
  const result = extractMultiField("uncertain: none", "uncertain");
  assert.deepEqual(result, []);
  console.log("  ✓ extractMultiField returns [] for 'none'");
}

export function testExtractMultiFieldSingle(): void {
  const result = extractMultiField("uncertain: maybe so", "uncertain");
  assert.deepEqual(result, ["maybe so"]);
  console.log("  ✓ extractMultiField single line");
}

export function testExtractMultiFieldMultiLine(): void {
  const text = [
    "## HANDOFF",
    "claimed: x",
    "uncertain: first issue",
    "  also second issue",
    "  and third",
    "not_done: none",
  ].join("\n");
  const result = extractMultiField(text, "uncertain");
  assert.deepEqual(result, ["first issue", "also second issue", "and third"]);
  console.log("  ✓ extractMultiField multi-line");
}

export function testExtractMultiFieldEmptyLineEndsField(): void {
  const text = ["uncertain: first issue", "", "not_done: leftover"].join("\n");
  const result = extractMultiField(text, "uncertain");
  assert.deepEqual(result, ["first issue"]);
  console.log("  ✓ extractMultiField stops at empty line");
}

export function testExtractMultiFieldNotFound(): void {
  const result = extractMultiField("claimed: x", "uncertain");
  assert.deepEqual(result, []);
  console.log("  ✓ extractMultiField returns [] when field missing");
}

export function testJsonResult(): void {
  const r = jsonResult({ foo: 1 });
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].type, "text");
  assert.equal(JSON.parse(r.content[0].text).foo, 1);
  console.log("  ✓ jsonResult wraps data in content");
}

export function testErrorResult(): void {
  const r = errorResult("oops");
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).error, "oops");
  console.log("  ✓ errorResult marks isError");
}

export function testParseToolResult(): void {
  const r = jsonResult({ a: 1 });
  assert.deepEqual(parseToolResult(r), { a: 1 });
  console.log("  ✓ parseToolResult round-trips");
}

export function testReasonCodesAreLocked(): void {
  assert.equal(REASON_CODES.length, 5);
  assert.ok(REASON_CODES.includes("missing_test"));
  assert.ok(REASON_CODES.includes("scope_mismatch"));
  assert.ok(REASON_CODES.includes("unsafe_command"));
  assert.ok(REASON_CODES.includes("spec_gap"));
  assert.ok(REASON_CODES.includes("other"));
  console.log("  ✓ REASON_CODES has 5 values (locked)");
}

export function testEndToEndPipeline(): void {
  const oldEnv = process.env.FAPONY_STATE_DIR;
  const tmpDir = mkdtempSync(join(tmpdir(), "fapony-mcp-e2e-"));
  process.env.FAPONY_STATE_DIR = tmpDir;
  try {
    withTempRepo((dir) => {
      // Make a commit
      writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");
      execSync("git add .", { cwd: dir, stdio: "ignore" });
      execSync("git commit -m 'add feature'", { cwd: dir, stdio: "ignore" });

      const baseSha = execSync("git rev-parse HEAD~1", {
        cwd: dir,
        encoding: "utf-8",
      }).trim();
      const headSha = execSync("git rev-parse HEAD", {
        cwd: dir,
        encoding: "utf-8",
      }).trim();

      // Step 1: collect
      const collectResult = toolHandoffCollect({
        base_sha: baseSha,
        head_sha: headSha,
        worktree: dir,
      });
      const collectData = parseToolResult(collectResult) as {
        facts: { commits: string[] };
      };

      // Step 2: check (agent reports uncertain/not_done/checks)
      const handoff = [
        "## HANDOFF",
        `claimed: ${headSha}`,
        `commits: ${headSha}`,
        "checks: typecheck pass",
        "uncertain: none",
        "not_done: none",
      ].join("\n");
      const checkResult = toolHandoffCheck({
        handoff,
        facts: { commits: collectData.facts.commits },
        uncertain: "none",
        not_done: "none",
        checks: "typecheck pass",
      });
      const checkData = parseToolResult(checkResult) as {
        summary: { failed: number };
      };
      assert.equal(checkData.summary.failed, 0);

      // Step 3: submit (auto-creates run)
      const verdictResult = toolVerdictSubmit({
        verdict: "pass",
        reason_code: "missing_test",
      });
      const verdictData = parseToolResult(verdictResult) as {
        stored: boolean;
        run_id: number;
      };
      assert.equal(verdictData.stored, true);
      assert.ok(verdictData.run_id > 0);
    });
  } finally {
    if (oldEnv !== undefined) {
      process.env.FAPONY_STATE_DIR = oldEnv;
    } else {
      delete process.env.FAPONY_STATE_DIR;
    }
  }
  console.log("  ✓ end-to-end pipeline: collect → check → submit");
}
