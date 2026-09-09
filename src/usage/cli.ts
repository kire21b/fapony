// src/usage/cli.ts — cmdUsageWeb + Bun.serve routes

import { loadConfig } from "../db/index.js";
import {
  readClaudeCodeUsage,
  readPassiveUsage,
  readZcodeUsage,
} from "../session/index.js";
import type { PassiveUsageResult } from "../session/types.js";
import { renderUsageHtml } from "./render.js";

const FAVICON_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function fetchAllUsage(): {
  opencode: PassiveUsageResult;
  zcode: PassiveUsageResult | null;
  claude_code: PassiveUsageResult | null;
} {
  const opencode = readPassiveUsage();
  const zcode = readZcodeUsage();
  const claude_code = readClaudeCodeUsage();
  return {
    opencode,
    zcode: zcode.session_count > 0 ? zcode : null,
    claude_code: claude_code.session_count > 0 ? claude_code : null,
  };
}

export function cmdUsageWeb(args: string[]): void {
  const config = loadConfig();
  const uw = config.usageWeb ?? {};

  const portArg = parseInt(args[0], 10);
  const port = Number.isNaN(portArg) ? (uw.port ?? 8080) : portArg;
  const hostname = args[1] || uw.hostname || "127.0.0.1";
  const intervalArg = parseInt(args[2], 10);
  const pollInterval = Number.isNaN(intervalArg)
    ? (uw.pollInterval ?? 3000)
    : intervalArg;

  if (args[0] && Number.isNaN(parseInt(args[0], 10))) {
    console.error("usage: fapony usage-web [port] [hostname] [pollInterval]");
    process.exit(1);
  }

  const initialData = fetchAllUsage();

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
          pollInterval,
        );
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/data") {
        const data = fetchAllUsage();
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
