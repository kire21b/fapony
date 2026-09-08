// src/install.ts — `fapony install --platform opencode` command.
// Adds mcp.fapony config to ~/.config/opencode/opencode.json or opencode.jsonc.
// Idempotent: no change if already configured. --dry-run shows diff without writing.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MCP_KEY = "fapony";
const MCP_CONFIG = {
  type: "local",
  command: ["bun", "run", "fapony.ts", "mcp"],
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

export function cmdInstall(args: string[]): void {
  const platform = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (platform !== "opencode") {
    console.error(`usage: fapony install --platform opencode [--dry-run]`);
    console.error(`  supported platforms: opencode`);
    process.exit(1);
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
