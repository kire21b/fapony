// test/mcp/transport.test.ts — tests for MCP JSON-RPC dispatch

import assert from "node:assert";
import { dispatch } from "../../src/mcp/transport.js";

export function testMcpToolsList(): void {
  const result = dispatch("tools/list", {});
  assert.ok(result && typeof result === "object");
  const r = result as { tools: { name: string }[] };
  assert.equal(r.tools.length, 8);
  assert.equal(r.tools[0].name, "handoff_collect");
  assert.equal(r.tools[1].name, "handoff_check");
  assert.equal(r.tools[2].name, "verdict_submit");
  assert.equal(r.tools[3].name, "fapony_stats");
  assert.equal(r.tools[4].name, "fapony_usage");
  assert.equal(r.tools[5].name, "verification_report");
  assert.equal(r.tools[6].name, "project_health_context");
  console.log("  ✓ mcp tools/list returns 7 tools");
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
