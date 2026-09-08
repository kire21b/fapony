// src/mcp/tools/stats.ts — fapony_stats tool

import { formatStatsText, getStatsData } from "../../stats.js";
import { jsonResult, type ToolResult } from "../types.js";

export function toolFaponyStats(args: Record<string, unknown>): ToolResult {
  const data = getStatsData();

  // json:true → StatsData ล้วน (SPEC-verdict-stats) — ห้ามแทรก text อื่น
  if (args.json === true) {
    return jsonResult(data);
  }

  // json:false → text เดียวกับ `fapony stats` — same formatter, raw (not JSON-wrapped)
  return { content: [{ type: "text", text: formatStatsText(data) }] };
}
