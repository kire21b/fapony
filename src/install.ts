// src/install.ts — `fapony install --platform opencode|claude|zcode` command.
// opencode: adds mcp.fapony config to ~/.config/opencode/opencode.json or opencode.jsonc.
// claude: shells out to `claude mcp add` (never parses/writes ~/.claude.json directly).
// zcode: reads/writes ~/.zcode/cli/config.json (fallback ~/.agents/mcp.json) directly.
// All platforms are idempotent + support --dry-run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertSafe } from "./safety.js";

/** Repo root (parent of src/) — absolute path to this fapony checkout,
 *  so `claude mcp add` works even before `bun link`. Same pattern as src/update.ts. */
export const INSTALL_ROOT = join(import.meta.dir, "..");

const MCP_KEY = "fapony";
const MCP_CONFIG = {
  type: "local",
  command: ["bun", "run", "fapony.ts", "mcp"],
};

/** ZCode uses the stdio MCP shape: command is a string, args is an array.
 *  See ~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/...
 *  (do not use OpenCode-style `command: [...]` in ZCode's JSON editor). */
const ZCODE_MCP_CONFIG = {
  type: "stdio",
  command: "bun",
  args: ["run", join(INSTALL_ROOT, "fapony.ts"), "mcp"],
};

function findOpencodeConfig(): string | null {
  const dir = join(homedir(), ".config", "opencode");
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function stripJsonc(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\") {
          out += input[i];
          i++;
        }
        if (i < input.length) {
          out += input[i];
          i++;
        }
      }
      if (i < input.length) {
        out += input[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function parseJsonc(text: string): Record<string, unknown> {
  return JSON.parse(stripJsonc(text)) as Record<string, unknown>;
}

function isConfigured(mcp: Record<string, unknown> | undefined): boolean {
  if (!mcp) return false;
  const entry = mcp[MCP_KEY];
  if (!entry || typeof entry !== "object") return false;
  const cfg = entry as Record<string, unknown>;
  return (
    cfg.type === MCP_CONFIG.type &&
    JSON.stringify(cfg.command) === JSON.stringify(MCP_CONFIG.command)
  );
}

function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const beforeStr = JSON.stringify(before, null, 2);
  const afterStr = JSON.stringify(after, null, 2);
  const beforeLines = beforeStr.split("\n");
  const afterLines = afterStr.split("\n");

  const diff: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b !== a) {
      if (b !== undefined) diff.push(`- ${b}`);
      if (a !== undefined) diff.push(`+ ${a}`);
    } else {
      diff.push(`  ${b}`);
    }
  }
  return diff.join("\n");
}

export function cmdInstall(args: string[], deps: InstallDeps = {}): void {
  const platform = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (platform === "claude") {
    cmdInstallClaude(dryRun, deps);
    return;
  }

  if (platform === "zcode") {
    cmdInstallZcode(dryRun, deps);
    return;
  }

  if (platform !== "opencode") {
    console.error(
      `usage: fapony install --platform opencode|claude|zcode [--dry-run]`,
    );
    console.error(`  supported platforms: opencode, claude, zcode`);
    (deps.exit ?? defaultExit)(1);
  }

  const configPath = findOpencodeConfig();
  let before: Record<string, unknown>;
  let isNew = false;

  if (configPath) {
    try {
      before = parseJsonc(readFileSync(configPath, "utf-8"));
    } catch (e) {
      console.error(`failed to parse ${configPath}: ${(e as Error).message}`);
      process.exit(1);
    }
  } else {
    isNew = true;
    before = {};
  }

  const mcp = (before.mcp as Record<string, unknown>) ?? {};
  if (isConfigured(mcp)) {
    console.error(`✓ mcp.${MCP_KEY} already configured — no change needed`);
    if (configPath) console.error(`  (${configPath})`);
    return;
  }

  const after = {
    ...before,
    mcp: {
      ...mcp,
      [MCP_KEY]: MCP_CONFIG,
    },
  };

  if (dryRun) {
    console.error(`── dry-run: would write mcp.${MCP_KEY} ──`);
    if (isNew) {
      console.error(
        `  (new file: ${join(homedir(), ".config", "opencode", "opencode.json")})`,
      );
    } else {
      console.error(`  (${configPath})`);
    }
    console.log(computeDiff(before, after));
    return;
  }

  const targetPath =
    configPath ?? join(homedir(), ".config", "opencode", "opencode.json");
  const dir = targetPath.split("/").slice(0, -1).join("/");
  if (!existsSync(dir)) {
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(targetPath, `${JSON.stringify(after, null, 2)}\n`);
  if (isNew) {
    console.error(`✓ created ${targetPath} with mcp.${MCP_KEY}`);
  } else {
    console.error(`✓ added mcp.${MCP_KEY} to ${configPath}`);
  }
  console.error(`  restart opencode to load the MCP server`);
}

// --- zcode platform (reads/writes JSON directly; ZCode has no `zcode mcp add` CLI) ---

/** Resolve the active ZCode config file. Primary: ~/.zcode/cli/config.json.
 *  Fallback: ~/.agents/mcp.json (only when primary is absent). */
function findZcodeConfig(
  getHome: () => string,
): { path: string; key: "mcp.servers" | "mcpServers" } | null {
  const primary = join(getHome(), ".zcode", "cli", "config.json");
  if (existsSync(primary)) return { path: primary, key: "mcp.servers" };
  const fallback = join(getHome(), ".agents", "mcp.json");
  if (existsSync(fallback)) return { path: fallback, key: "mcpServers" };
  return null;
}

function getZcodeServers(
  cfg: Record<string, unknown>,
  key: "mcp.servers" | "mcpServers",
): Record<string, unknown> | undefined {
  if (key === "mcpServers") {
    return cfg.mcpServers as Record<string, unknown> | undefined;
  }
  const mcp = cfg.mcp as Record<string, unknown> | undefined;
  return mcp?.servers as Record<string, unknown> | undefined;
}

function setZcodeServers(
  cfg: Record<string, unknown>,
  key: "mcp.servers" | "mcpServers",
  servers: Record<string, unknown>,
): Record<string, unknown> {
  if (key === "mcpServers") {
    return { ...cfg, mcpServers: servers };
  }
  const mcp = (cfg.mcp as Record<string, unknown>) ?? {};
  return { ...cfg, mcp: { ...mcp, servers } };
}

function isZcodeConfigured(
  servers: Record<string, unknown> | undefined,
): boolean {
  if (!servers) return false;
  const entry = servers[MCP_KEY];
  if (!entry || typeof entry !== "object") return false;
  const cfg = entry as Record<string, unknown>;
  if (cfg.type !== "stdio" && cfg.type !== undefined) return false;
  if (cfg.command !== ZCODE_MCP_CONFIG.command) return false;
  if (!Array.isArray(cfg.args)) return false;
  return JSON.stringify(cfg.args) === JSON.stringify(ZCODE_MCP_CONFIG.args);
}

export function cmdInstallZcode(dryRun: boolean, deps: InstallDeps = {}): void {
  const exitFn = deps.exit ?? defaultExit;
  const getHome = deps.homedir ?? (() => homedir());

  const found = findZcodeConfig(getHome);
  if (!found) {
    console.error(
      `ZCode config not found — open ZCode at least once to create ~/.zcode/cli/config.json`,
    );
    exitFn(1);
    return;
  }

  let before: Record<string, unknown>;
  try {
    before = JSON.parse(readFileSync(found.path, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch (e) {
    console.error(`failed to parse ${found.path}: ${(e as Error).message}`);
    exitFn(1);
    return;
  }

  const servers = getZcodeServers(before, found.key) ?? {};
  if (isZcodeConfigured(servers)) {
    console.error(`✓ mcp.${MCP_KEY} already configured — no change needed`);
    console.error(`  (${found.path})`);
    return;
  }

  const after = setZcodeServers(before, found.key, {
    ...servers,
    [MCP_KEY]: ZCODE_MCP_CONFIG,
  });

  if (dryRun) {
    console.error(`── dry-run: would write ${found.key}.${MCP_KEY} ──`);
    console.error(`  (${found.path})`);
    console.log(computeDiff(before, after));
    return;
  }

  writeFileSync(found.path, `${JSON.stringify(after, null, 2)}\n`);
  console.error(`✓ added mcp.${MCP_KEY} to ${found.path}`);
  if (found.key === "mcpServers") {
    console.error(`  (fallback path: ~/.agents/mcp.json)`);
  }
  console.error(`  restart ZCode to load the MCP server`);
}

// --- claude platform (shells out to the Claude Code CLI, never touches ~/.claude.json) ---

export interface ClaudeRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface InstallDeps {
  /** Run argv synchronously. Defaults to Bun.spawnSync. Injected in tests. */
  run?: (argv: string[]) => ClaudeRunResult;
  exit?: (code: number) => never;
  /** Override os.homedir() for tests. */
  homedir?: () => string;
}

function defaultExit(code: number): never {
  return process.exit(code);
}

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
  }

  if (get.exitCode === 0) {
    if (claudeGetPointsToFapony(`${get.stdout}\n${get.stderr}`)) {
      console.error(`✓ mcp.fapony already configured — no change needed`);
      console.error(`  (Claude Code user scope)`);
      return;
    }
    console.error(
      `an MCP server named "fapony" exists but points elsewhere — not overwriting.`,
    );
    console.error(`  inspect with: claude mcp get fapony`);
    console.error(`  then remove it first: claude mcp remove fapony -s user`);
    exitFn(1);
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
  }
  if (add.exitCode !== 0) {
    console.error(
      `failed to add mcp.fapony to Claude Code (exit ${add.exitCode})`,
    );
    const detail = `${add.stdout}\n${add.stderr}`.trim();
    if (detail) console.error(detail);
    console.error(`verify with: claude mcp add --help`);
    exitFn(1);
  }
  console.error(`✓ mcp.fapony configured for Claude Code (user scope)`);
}
