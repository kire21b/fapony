// src/report.ts — `fapony report <run-id>` CLI command
//
// Thin CLI wrapper over the verification_report MCP tool: same composition,
// same output, no second facts/verdict/cost implementation.

import { toolVerificationReport } from "./mcp/tools/report.js";
import { parseToolResult } from "./mcp/types.js";

export function cmdReport(args: string[]): void {
  const runId = parseInt(args[0], 10);
  if (!runId || Number.isNaN(runId)) {
    console.error("usage: fapony report <run-id>");
    process.exit(1);
  }

  const result = toolVerificationReport({ run_id: runId });
  if (result.isError) {
    const data = parseToolResult(result) as { error?: unknown };
    console.error(
      `fapony report: ${typeof data.error === "string" ? data.error : "unknown error"}`,
    );
    process.exit(1);
  }
  console.log(result.content[0].text);
}
