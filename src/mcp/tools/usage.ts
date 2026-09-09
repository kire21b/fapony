// src/mcp/tools/usage.ts — fapony_usage tool

import { type PassiveUsageResult, readPassiveUsage } from "../../session.js";
import { jsonResult, type ToolResult } from "../types.js";

export function toolPassiveUsage(args: Record<string, unknown>): ToolResult {
  const worktree =
    typeof args.worktree === "string" ? args.worktree : undefined;
  const since = typeof args.since === "number" ? args.since : undefined;
  const until = typeof args.until === "number" ? args.until : undefined;
  const detail = args.detail === true;

  const data: PassiveUsageResult = readPassiveUsage(
    worktree,
    since,
    until,
    detail,
  );

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

  // detail:true is opt-in — default text above is byte-identical to before.
  if (detail && data.detail) {
    lines.push("");
    lines.push("Detail (tool activity — signal, not quality):");
    lines.push(`  steps: ${data.detail.steps.toLocaleString()}`);
    const tools = Object.entries(data.detail.tool_breakdown).sort(
      (a, b) => b[1] - a[1],
    );
    if (tools.length > 0) {
      lines.push("  by tool:");
      for (const [tool, count] of tools.slice(0, 20)) {
        lines.push(`    ${tool}: ${count.toLocaleString()}`);
      }
      if (tools.length > 20) {
        lines.push(`    ... +${tools.length - 20} more (see json:true)`);
      }
    }
    lines.push(`  sessions with activity: ${data.detail.by_session.length}`);
    const top = data.detail.by_session.slice(0, 10);
    for (const s of top) {
      const topTool = Object.entries(s.tools).sort((a, b) => b[1] - a[1])[0];
      lines.push(
        `    ${s.session_id}: ${s.steps} steps` +
          (topTool ? `, top tool ${topTool[0]}×${topTool[1]}` : ""),
      );
    }
    if (data.detail.by_session.length > 10) {
      lines.push(
        `    ... +${data.detail.by_session.length - 10} more (see json:true)`,
      );
    }
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
