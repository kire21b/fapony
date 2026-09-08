// test/mcp/evidence.test.ts — tests for evidence collector

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectEvidence, readEvidenceConfig } from "../../src/mcp/evidence.js";

function makeTmpWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), "fapony-evidence-"));
  mkdirSync(join(dir, ".fapony"), { recursive: true });
  return dir;
}

// --- readEvidenceConfig ---

export function testReadEvidenceConfigMissing(): void {
  const dir = makeTmpWorktree();
  try {
    const config = readEvidenceConfig(dir);
    assert.equal(config, null);
    console.log("  ✓ readEvidenceConfig returns null when file missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadEvidenceConfigInvalid(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(join(dir, ".fapony/evidence.json"), "not json");
    const config = readEvidenceConfig(dir);
    assert.equal(config, null);
    console.log("  ✓ readEvidenceConfig returns null on invalid JSON");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testReadEvidenceConfigValid(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "test", cmd: "echo ok", timeout_ms: 5000 }],
      }),
    );
    const config = readEvidenceConfig(dir);
    assert.ok(config);
    assert.equal(config.commands.length, 1);
    assert.equal(config.commands[0].cmd, "echo ok");
    assert.equal(config.commands[0].timeout_ms, 5000);
    console.log("  ✓ readEvidenceConfig parses valid config");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- collectEvidence ---

export function testCollectEvidenceNoConfig(): void {
  const dir = makeTmpWorktree();
  try {
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 0);
    console.log("  ✓ collectEvidence returns empty when no config");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidencePassingCommand(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "echo", cmd: "echo ok", timeout_ms: 5000 }],
      }),
    );
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "passed");
    assert.equal(items[0].exit_code, 0);
    assert.equal(items[0].provenance.verified, true);
    assert.equal(items[0].provenance.source, "fapony_cli");
    assert.ok(items[0].duration_ms !== null);
    console.log("  ✓ collectEvidence runs passing command");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceFailingCommand(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "fail", cmd: "exit 1", timeout_ms: 5000 }],
      }),
    );
    const items = collectEvidence({ worktree: dir });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "failed");
    assert.equal(items[0].exit_code, 1);
    console.log("  ✓ collectEvidence detects failing command");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceAgentCommands(): void {
  const dir = makeTmpWorktree();
  try {
    const items = collectEvidence({
      worktree: dir,
      agentCommands: ["echo agent"],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "passed");
    assert.equal(items[0].provenance.verified, false);
    assert.equal(items[0].provenance.source, "agent_report");
    console.log("  ✓ collectEvidence agent commands get unverified provenance");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testCollectEvidenceAgentDuplicatesAllowlist(): void {
  const dir = makeTmpWorktree();
  try {
    writeFileSync(
      join(dir, ".fapony/evidence.json"),
      JSON.stringify({
        commands: [{ name: "test", cmd: "echo ok", timeout_ms: 5000 }],
      }),
    );
    // Agent proposes same command — should be skipped
    const items = collectEvidence({
      worktree: dir,
      agentCommands: ["echo ok"],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].provenance.source, "fapony_cli");
    console.log("  ✓ collectEvidence skips agent cmd already in allowlist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
