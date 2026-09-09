// src/usage/cli.ts — cmdUsageWeb + Bun.serve routes

import { loadConfig } from "../db/index.js";
import {
  readClaudeCodeUsage,
  readCodexUsage,
  readPassiveUsage,
  readZcodeUsage,
} from "../session/index.js";
import type { PassiveUsageResult } from "../session/types.js";
import { renderUsageHtml } from "./render.js";

const FAVICON_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/**
 * Default lookback window for Claude Code / Codex — those readers have no
 * SQL to aggregate in, every call fully reads+parses every JSONL session
 * file on disk. A `since` cutoff lets the file loop skip whole files by
 * mtime (see claude-code.ts/codex.ts) instead of reading years of history
 * on every poll. --full lifts it for an exact all-time total.
 */
const DEFAULT_JSONL_LOOKBACK_DAYS = 30;

function fetchAllUsage(full: boolean): {
  opencode: PassiveUsageResult;
  zcode: PassiveUsageResult | null;
  claude_code: PassiveUsageResult | null;
  codex: PassiveUsageResult | null;
} {
  const since = full
    ? undefined
    : Date.now() / 1000 - DEFAULT_JSONL_LOOKBACK_DAYS * 86400;
  const opencode = readPassiveUsage(undefined, undefined, undefined, {
    detail: true,
    full,
  });
  const zcode = readZcodeUsage(undefined, undefined, undefined, true, full);
  const claude_code = readClaudeCodeUsage(undefined, since);
  const codex = readCodexUsage(undefined, since);
  return {
    opencode,
    zcode: zcode.session_count > 0 ? zcode : null,
    claude_code: claude_code.session_count > 0 ? claude_code : null,
    codex: codex.session_count > 0 ? codex : null,
  };
}

export function cmdUsageWeb(rawArgs: string[]): void {
  const full = rawArgs.includes("--full");
  const args = rawArgs.filter((a) => a !== "--full");
  const config = loadConfig();
  const uw = config.usageWeb ?? {};

  const portArg = parseInt(args[0], 10);
  const port = Number.isNaN(portArg) ? (uw.port ?? 8080) : portArg;
  const hostname = args[1] || uw.hostname || "127.0.0.1";
  const intervalArg = parseInt(args[2], 10);
  const pollInterval = Number.isNaN(intervalArg)
    ? (uw.pollInterval ?? 3000)
    : intervalArg;
  const ownerName = uw.ownerName?.trim() ? uw.ownerName.trim() : undefined;

  if (args[0] && Number.isNaN(parseInt(args[0], 10))) {
    console.error(
      "usage: fapony usage-web [port] [hostname] [pollInterval] [--full]",
    );
    process.exit(1);
  }

  const initialData = fetchAllUsage(full);

  const server = Bun.serve({
    hostname,
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/") {
        const html = renderUsageHtml(
          initialData.opencode,
          initialData.zcode,
          initialData.claude_code,
          initialData.codex,
          pollInterval,
          ownerName,
          full,
        );
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/data") {
        const data = fetchAllUsage(full);
        return Response.json(data);
      }

      if (url.pathname === "/favicon.ico") {
        return new Response(FAVICON_GIF, {
          headers: { "Content-Type": "image/gif" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`fapony usage-web → http://${server.hostname}:${server.port}`);
}
