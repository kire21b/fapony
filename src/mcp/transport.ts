// src/mcp/transport.ts — JSON-RPC dispatch + stdio entry point

import { createInterface } from "node:readline";
import {
  TOOLS,
  toolFaponyStats,
  toolHandoffCheck,
  toolHandoffCollect,
  toolPassiveUsage,
  toolProjectHealthContext,
  toolVerdictSubmit,
  toolVerificationReport,
} from "./tools/index.js";
import { errorResult, type ToolResult } from "./types.js";

// --- MCP protocol constants ---

const MCP_PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "fapony-handcheck";
const SERVER_VERSION = "0.1.0";

// --- JSON-RPC dispatch ---

export function dispatch(
  method: string,
  params: unknown,
): object | ToolResult | null {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    case "notifications/initialized":
      return null; // no response needed
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return dispatchToolCall(
        params as { name: string; arguments?: Record<string, unknown> },
      );
    default:
      return {
        code: -32601,
        message: `method not found: ${method}`,
      };
  }
}

function dispatchToolCall(params: {
  name: string;
  arguments?: Record<string, unknown>;
}): ToolResult {
  const args = params.arguments ?? {};
  switch (params.name) {
    case "handoff_collect":
      return toolHandoffCollect(args);
    case "handoff_check":
      return toolHandoffCheck(args);
    case "verdict_submit":
      return toolVerdictSubmit(args);
    case "fapony_stats":
      return toolFaponyStats(args);
    case "fapony_usage":
      return toolPassiveUsage(args);
    case "project_health_context":
      return toolProjectHealthContext(args);
    case "verification_report":
      return toolVerificationReport(args);
    default:
      return errorResult(`unknown tool: ${params.name}`);
  }
}

// --- Entry point ---

export function cmdMcp(): void {
  const rl = createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: { id?: number; method: string; params?: unknown };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Invalid JSON — send error
      const resp = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(`${JSON.stringify(resp)}\n`);
      return;
    }

    const result = dispatch(msg.method, msg.params ?? {});

    // notifications don't get a response
    if (result === null) return;

    const resp: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: msg.id ?? null,
    };

    if (
      result &&
      typeof result === "object" &&
      "content" in result &&
      "isError" in result
    ) {
      // Tool result
      resp.result = result;
    } else if (
      result &&
      typeof result === "object" &&
      "code" in result &&
      "message" in result
    ) {
      // Error response
      resp.error = result;
    } else {
      // Normal result
      resp.result = result;
    }

    process.stdout.write(`${JSON.stringify(resp)}\n`);
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
