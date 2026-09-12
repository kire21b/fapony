// src/report/cli.ts — CLI commands for fapony report / report-web

import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { loadConfig } from "../db/index.js";
import { toolVerificationReport } from "../mcp/tools/report.js";
import { parseToolResult } from "../mcp/types.js";
import { getStatsData } from "../stats/data.js";
import { renderReportHtml } from "./render.js";

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

export function cmdReportWeb(args: string[]): void {
  const config = loadConfig();
  // Accept optional --worktree <path> to scope the report to one project.
  const wtIdx = args.indexOf("--worktree");
  const worktree =
    wtIdx !== -1 && args[wtIdx + 1] ? args[wtIdx + 1] : undefined;
  // First positional arg is still the output file (legacy).
  const outFile =
    wtIdx !== -1
      ? args.filter((_a, i) => i !== wtIdx && i !== wtIdx + 1)[0]
      : args[0];

  if (outFile) {
    // Rule #5: fapony never writes into a target worktree — refuse output
    // paths inside a configured worktree. Stdout stays always available.
    const abs = resolve(outFile);
    for (const wt of Object.values(config.worktrees ?? {})) {
      if (abs === wt || abs.startsWith(wt + sep)) {
        console.error(
          `fapony report-web: refusing to write inside worktree "${wt}" — choose a path outside worktrees or omit the file to print to stdout`,
        );
        process.exit(1);
      }
    }
  }

  const uw = config.usageWeb ?? {};

  const ownerName = uw.ownerName?.trim() ? uw.ownerName.trim() : undefined;
  const stats = getStatsData(worktree);
  const html = renderReportHtml(stats, new Date().toISOString(), ownerName);

  if (outFile) {
    writeFileSync(outFile, html, "utf-8");
    console.log(`report written to ${outFile}`);
  } else {
    console.log(html);
  }
}
