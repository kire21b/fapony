// src/mcp/types.ts — ReasonCode enum, ToolResult, helpers

// --- ReasonCode enum (locked in step 0, append-only) ---

export const REASON_CODES = [
  "missing_test",
  "scope_mismatch",
  "unsafe_command",
  "spec_gap",
  "other",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

// --- Tool result types ---

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function parseToolResult(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text);
}
