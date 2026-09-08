// src/mcp/tools/usage.ts — fapony_usage tool

import { type PassiveUsageResult, readPassiveUsage } from "../../session.js";
import { jsonResult, type ToolResult } from "../types.js";

export function toolPassiveUsage(args: Record<string, unknown>): ToolResult {
  const worktree =
    typeof args.worktree === "string" ? args.worktree : undefined;
  const since = typeof args.since === "number" ? args.since : undefined;
  const until = typeof args.until === "number" ? args.until : undefined;

  const data: PassiveUsageResult = readPassiveUsage(worktree, since, until);

  if (args.json === true) {
    return jsonResult(data);
  }

  const lines: string[] = [];
  lines.push("Passive Usage Report");
  lines.push("====================");
  lines.push(`Sessions: ${data.session_count}`);
  lines.push(`Total Input Tokens: ${data.total_tokens_input.toLocaleString()}`);
  lines.push(
    `Total Output Tokens: ${data.total_tokens_output.toLocaleString()}`,
  );
  lines.push(
    `Total Reasoning Tokens: ${data.total_tokens_reasoning.toLocaleString()}`,
  );
  lines.push(`Cache Read: ${data.total_tokens_cache_read.toLocaleString()}`);
  lines.push(`Cache Write: ${data.total_tokens_cache_write.toLocaleString()}`);
  lines.push(`Total Cost: $${data.total_cost.toFixed(4)}`);

  if (data.by_model.length > 0) {
    lines.push("");
    lines.push("By Model:");
    lines.push("--------");
    for (const m of data.by_model) {
      lines.push(
        `  ${m.model}: ${m.session_count} sessions, ` +
          `${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out, ` +
          `$${m.cost.toFixed(4)}`,
      );
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
