import assert from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ClaudeRunResult,
  claudeAddArgs,
  claudeGetArgs,
  claudeGetPointsToFapony,
  cmdInstall,
  cmdInstallClaude,
  INSTALL_ROOT,
  type InstallDeps,
} from "../src/install.js";
import { silentErrors } from "./helpers.js";

class TestExit extends Error {
  code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

function testExit(code: number): never {
  throw new TestExit(code);
}

/** Mock runner: map joined-argv → result. Records every call. */
function mapRun(table: Record<string, ClaudeRunResult | Error>): {
  run: (argv: string[]) => ClaudeRunResult;
  calls: string[];
} {
  const calls: string[] = [];
  const run = (argv: string[]): ClaudeRunResult => {
    calls.push(argv.join(" "));
    const hit = table[argv.join(" ")];
    if (hit instanceof Error) throw hit;
    if (hit) return hit;
    throw new Error(`unexpected argv: ${argv.join(" ")}`);
  };
  return { run, calls };
}

function captureErrors(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return lines.join("\n");
}

const GET = claudeGetArgs().join(" ");
const ABSENT: ClaudeRunResult = {
  exitCode: 1,
  stdout: "",
  stderr: 'No MCP server named "fapony".',
};
const PRESENT: ClaudeRunResult = {
  exitCode: 0,
  stdout: [
    "fapony:",
    "  Scope: User config (available in all your projects)",
    "  Type: stdio",
    "  Command: bun",
    `  Args: ${join(INSTALL_ROOT, "fapony.ts")} mcp`,
  ].join("\n"),
  stderr: "",
};
const ADDED: ClaudeRunResult = {
  exitCode: 0,
  stdout: "Added stdio MCP server fapony",
  stderr: "",
};

export function testInstallRootIsRepoRoot(): void {
  assert.ok(
    existsSync(join(INSTALL_ROOT, "package.json")),
    `INSTALL_ROOT must be the repo root, got: ${INSTALL_ROOT}`,
  );
  assert.ok(
    existsSync(join(INSTALL_ROOT, "fapony.ts")),
    `INSTALL_ROOT must contain fapony.ts, got: ${INSTALL_ROOT}`,
  );
  console.log("  ✓ install INSTALL_ROOT is repo root");
}

export function testClaudeAddUsesAbsolutePath(): void {
  const args = claudeAddArgs();
  assert.deepStrictEqual(args.slice(0, 7), [
    "claude",
    "mcp",
    "add",
    "fapony",
    "-s",
    "user",
    "--",
  ]);
  // Never relies on PATH: absolute fapony.ts + explicit `mcp` subcommand.
  assert.equal(args[7], "bun");
  assert.equal(args[8], join(INSTALL_ROOT, "fapony.ts"));
  assert.equal(args[9], "mcp");
  console.log("  ✓ install claude add uses absolute path");
}

export function testClaudeGetPointsToFapony(): void {
  assert.ok(claudeGetPointsToFapony(PRESENT.stdout));
  assert.ok(!claudeGetPointsToFapony("unrelated-server:\n  Command: node"));
  console.log("  ✓ install claude get ownership check");
}

export function testInstallClaudeAbsentAdds(): void {
  const ADD = claudeAddArgs().join(" ");
  const { run, calls } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  const err = silentErrors(() =>
    captureErrors(() => cmdInstallClaude(false, { run, exit: testExit })),
  );
  assert.deepStrictEqual(calls, [GET, ADD]);
  assert.ok(err.includes("configured for Claude Code"), `got: ${err}`);
  console.log("  ✓ install claude absent → add");
}

export function testInstallClaudeAlreadyConfiguredNoOp(): void {
  const { run, calls } = mapRun({ [GET]: PRESENT });
  const err = silentErrors(() =>
    captureErrors(() => cmdInstallClaude(false, { run, exit: testExit })),
  );
  assert.deepStrictEqual(calls, [GET]);
  assert.ok(err.includes("already configured"), `got: ${err}`);
  console.log("  ✓ install claude present → no-op");
}

export function testInstallClaudeDifferentCommandRefusesOverwrite(): void {
  const SQUAT: ClaudeRunResult = {
    exitCode: 0,
    stdout: "fapony:\n  Command: node\n  Args: /tmp/evil.js",
    stderr: "",
  };
  const { run, calls } = mapRun({ [GET]: SQUAT });
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstallClaude(false, { run, exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
  assert.equal(code, 1);
  assert.deepStrictEqual(calls, [GET]);
  assert.ok(err.includes("not overwriting"), `got: ${err}`);
  console.log("  ✓ install claude foreign entry → refuse overwrite");
}

export function testInstallClaudeDryRunNeverAdds(): void {
  const { run, calls } = mapRun({ [GET]: ABSENT });
  const err = silentErrors(() =>
    captureErrors(() => cmdInstallClaude(true, { run, exit: testExit })),
  );
  assert.deepStrictEqual(calls, [GET]);
  assert.ok(err.includes("dry-run"), `got: ${err}`);
  console.log("  ✓ install claude dry-run never adds");
}

export function testInstallClaudeMissingBinary(): void {
  const MISSING: ClaudeRunResult = {
    exitCode: 127,
    stdout: "",
    stderr: "ENOENT: no such file",
  };
  const { run } = mapRun({ [GET]: MISSING });
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstallClaude(false, { run, exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
  assert.equal(code, 1);
  assert.ok(err.includes("claude CLI not found"), `got: ${err}`);
  console.log("  ✓ install claude missing binary → clear error");
}

export function testInstallClaudeAddFailureHintsHelp(): void {
  const ADD = claudeAddArgs().join(" ");
  const FAILED: ClaudeRunResult = {
    exitCode: 1,
    stdout: "",
    stderr: "error: unknown option '--bogus'",
  };
  const { run } = mapRun({ [GET]: ABSENT, [ADD]: FAILED });
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstallClaude(false, { run, exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
  assert.equal(code, 1);
  assert.ok(err.includes("claude mcp add --help"), `got: ${err}`);
  console.log("  ✓ install claude add failure hints --help");
}

export function testCmdInstallDispatchesClaude(): void {
  // cmdInstall routes --platform claude through the same seam (3rd case:
  // dispatch itself, alongside absent/present/different above).
  const ADD = claudeAddArgs().join(" ");
  const { run, calls } = mapRun({ [GET]: ABSENT, [ADD]: ADDED });
  const deps: InstallDeps = { run, exit: testExit };
  silentErrors(() => cmdInstall(["install", "claude"].slice(1), deps));
  assert.deepStrictEqual(calls, [GET, ADD]);
  console.log("  ✓ install dispatch routes --platform claude");
}

export function testCmdInstallRejectsUnknownPlatform(): void {
  let code: number | null = null;
  const err = silentErrors(() =>
    captureErrors(() => {
      try {
        cmdInstall(["windows"], { exit: testExit });
      } catch (e) {
        code = (e as TestExit).code;
      }
    }),
  );
  assert.equal(code, 1);
  assert.ok(err.includes("opencode|claude"), `got: ${err}`);
  console.log("  ✓ install rejects unknown platform");
}
