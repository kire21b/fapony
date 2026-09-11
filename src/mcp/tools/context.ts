// src/mcp/tools/context.ts — project_health_context tool
//
// Single-call entry for `plan-with-pony`: returns the paste-ready "known
// patterns" block built from real run history (no raw dump, ~15 lines max).

import { buildProjectHealthContext } from "../../context/index.js";
import { getStatsData } from "../../stats.js";
import type { ToolResult } from "../types.js";

export function toolProjectHealthContext(
  args: Record<string, unknown>,
): ToolResult {
  const worktree =
    typeof args.worktree === "string" && args.worktree
      ? args.worktree
      : undefined;
  const files =
    Array.isArray(args.files) && args.files.length > 0
      ? args.files.filter(
          (f): f is string => typeof f === "string" && f.length > 0,
        )
      : undefined;
  const block = buildProjectHealthContext(getStatsData(), { worktree, files });
  return { content: [{ type: "text", text: block }] };
}
