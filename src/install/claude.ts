// src/install/claude.ts — Claude Code install provider
//
// Shells out to `claude mcp add` (never parses/writes ~/.claude.json directly).

import { homedir } from "node:os";
import { join } from "node:path";
import { assertSafe } from "../safety.js";
import { claudeSkillsDir, linkSkills, reportSkills } from "./skills.js";
import {
  type ClaudeRunResult,
  defaultExit,
  INSTALL_ROOT,
  type InstallDeps,
} from "./types.js";

function defaultRun(argv: string[]): ClaudeRunResult {
  assertSafe(argv);
  try {
    const proc = Bun.spawnSync(argv, {
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } catch (e) {
    // `claude` binary missing (ENOENT) or spawn failed outright.
    return { exitCode: 127, stdout: "", stderr: (e as Error).message };
  }
}

/** `claude mcp get fapony` — read-only probe. exit 0 = an entry named fapony exists. */
export function claudeGetArgs(): string[] {
  return ["claude", "mcp", "get", "fapony"];
}

/** Absolute-path add command — works even before `bun link` puts `fapony` on PATH. */
export function claudeAddArgs(): string[] {
  return [
    "claude",
    "mcp",
    "add",
    "fapony",
    "-s",
    "user",
    "--",
    "bun",
    join(INSTALL_ROOT, "fapony.ts"),
    "mcp",
  ];
}

function isClaudeMissing(res: ClaudeRunResult): boolean {
  return (
    res.exitCode === 127 ||
    /ENOENT|command not found|not found/i.test(res.stderr) ||
    /ENOENT|command not found|not found/i.test(res.stdout)
  );
}

/**
 * An existing `fapony` entry counts as ours when its Command:/Args: lines
 * mention fapony (covers both `bun <abs>/fapony.ts mcp` and `fapony mcp`
 * launchers). Only those lines are inspected — the `fapony:` header matches
 * trivially and proves nothing. Anything else under our name is someone
 * else's entry — never overwrite it silently.
 */
export function claudeGetPointsToFapony(getOutput: string): boolean {
  const cmdLines = getOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("Command:") || l.startsWith("Args:"));
  return cmdLines.join("\n").includes("fapony");
}

export function cmdInstallClaude(
  dryRun: boolean,
  deps: InstallDeps = {},
): void {
  const run = deps.run ?? defaultRun;
  const exitFn = deps.exit ?? defaultExit;

  const getArgs = claudeGetArgs();
  assertSafe(getArgs);
  const get = run(getArgs);
  if (isClaudeMissing(get)) {
    console.error(`claude CLI not found — install Claude Code first`);
    exitFn(1);
    return;
  }

  if (get.exitCode === 0) {
    if (claudeGetPointsToFapony(`${get.stdout}\n${get.stderr}`)) {
      console.error(`✓ mcp.fapony already configured — no change needed`);
      console.error(`  (Claude Code user scope)`);
      const dir = claudeSkillsDir(deps.homedir ?? homedir);
      reportSkills(linkSkills(dir, dryRun), dir, dryRun);
      return;
    }
    console.error(
      `an MCP server named "fapony" exists but points elsewhere — not overwriting.`,
    );
    console.error(`  inspect with: claude mcp get fapony`);
    console.error(`  then remove it first: claude mcp remove fapony -s user`);
    exitFn(1);
    return;
  }

  const addArgs = claudeAddArgs();
  if (dryRun) {
    console.error(`── dry-run: would run ──`);
    console.error(`  ${addArgs.join(" ")}`);
    return;
  }

  assertSafe(addArgs);
  const add = run(addArgs);
  if (isClaudeMissing(add)) {
    console.error(`claude CLI not found — install Claude Code first`);
    exitFn(1);
    return;
  }
  if (add.exitCode !== 0) {
    console.error(
      `failed to add mcp.fapony to Claude Code (exit ${add.exitCode})`,
    );
    const detail = `${add.stdout}\n${add.stderr}`.trim();
    if (detail) console.error(detail);
    console.error(`verify with: claude mcp add --help`);
    exitFn(1);
    return;
  }
  console.error(`✓ mcp.fapony configured for Claude Code (user scope)`);
  const skillsDir = claudeSkillsDir(deps.homedir ?? homedir);
  reportSkills(linkSkills(skillsDir, dryRun), skillsDir, dryRun);
}
