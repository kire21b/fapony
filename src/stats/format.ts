// src/stats/format.ts — formatStatsText() for CLI + MCP text mode

import type { StatsData } from "./data.js";

function fmtRate(r: number): string {
  return `${(r * 100).toFixed(0)}%`;
}

function fmtNullable(n: number | null, digits = 2): string {
  return n !== null ? n.toFixed(digits) : "—";
}

export function formatStatsText(data: StatsData): string {
  if (data.runs.total === 0) return "no runs yet";

  const lines: string[] = [];

  lines.push(
    `runs: ${data.runs.total}  (${Object.entries(data.runs.byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")})`,
  );
  lines.push(
    `pass rate: ${fmtRate(data.runs.passRate)}  stall rate: ${fmtRate(data.runs.stallRate)}`,
  );
  lines.push(
    `avg rounds to pass: ${data.runs.avgRounds.toFixed(1)}  avg time to pass: ${data.runs.avgMinutes.toFixed(0)}m`,
  );

  if (data.cost.spawns > 0) {
    const usd =
      data.cost.usd_estimate !== null
        ? ` (~$${data.cost.usd_estimate.toFixed(4)} est.)`
        : "";
    lines.push(
      `cost: ${data.cost.bytes_in} bytes in / ${data.cost.bytes_out} bytes out over ${data.cost.spawns} spawns${usd}`,
    );
  }

  lines.push(
    `avg exec time (spawn→route): ${data.stages.exec.avg.toFixed(1)}m over ${data.stages.exec.count} rounds`,
  );
  lines.push(
    `avg review turnaround (route→gate): ${data.stages.review.avg.toFixed(1)}m over ${data.stages.review.count} rounds`,
  );

  if (data.byModel.length > 0) {
    lines.push("\nby model:");
    lines.push("  model | gates | avgQuality | avgCostUSD | avgValue");
    lines.push("  ------|-------|------------|------------|--------");
    for (const m of data.byModel) {
      lines.push(
        `  ${m.model.padEnd(8)} | ${String(m.gateCount).padStart(5)} | ${m.avgQuality.toFixed(1).padStart(10)} | ${fmtNullable(m.avgCostUSD).padStart(10)} | ${fmtNullable(m.avgValue).padStart(8)}`,
      );
    }
  }

  if (data.byGrade.length > 0) {
    lines.push("\nby grade:");
    lines.push("  grade | count | avgCostUSD");
    lines.push("  ------|-------|-----------");
    for (const g of data.byGrade) {
      lines.push(
        `  ${g.grade.padEnd(14)} | ${String(g.count).padStart(5)} | ${fmtNullable(g.avgCostUSD).padStart(10)}`,
      );
    }
  }

  if (data.byWorktree.length > 0) {
    lines.push("\nby worktree:");
    lines.push("  worktree | runs | passed | stalled");
    lines.push("  ---------|------|--------|--------");
    for (const w of data.byWorktree) {
      lines.push(
        `  ${w.worktree.padEnd(8)} | ${String(w.runs).padStart(4)} | ${String(w.passed).padStart(6)} | ${String(w.stalled).padStart(7)}`,
      );
    }
  }

  const effShown = data.efficiency.filter((e) => e.quality !== null);
  if (effShown.length > 0) {
    lines.push(
      "\nderived: efficiency (ES/CPQ per run — activity signal, not quality)",
    );
    lines.push("  run | grade | ES | CPQ | basis");
    lines.push("  ----|-------|----|-----|------");
    for (const e of effShown) {
      const es =
        e.es !== null && Number.isFinite(e.es) ? e.es.toExponential(2) : "—";
      const cpq =
        e.cpq !== null
          ? e.basis === "usd"
            ? `$${e.cpq.toFixed(4)}`
            : `${Math.round(e.cpq)}B`
          : "—";
      lines.push(
        `  ${String(e.runId).padStart(3)} | ${(e.grade ?? "?").padEnd(14)} | ${es.padStart(9)} | ${cpq.padStart(9)} | ${e.basis}`,
      );
    }
  }

  if (data.usage.session_count > 0) {
    lines.push("\nusage:");
    lines.push(
      `  total: ${data.usage.total_tokens_input} input / ${data.usage.total_tokens_output} output / ${data.usage.total_tokens_reasoning} reasoning tokens over ${data.usage.session_count} sessions ($${data.usage.total_cost.toFixed(4)})`,
    );
    if (data.usage.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of data.usage.by_model) {
        lines.push(
          `    ${m.model}: ${m.tokens_input} in / ${m.tokens_output} out ($${m.cost.toFixed(4)})`,
        );
      }
    }
  }

  // ZCode usage (separate DB)
  if (data.zcodeUsage && data.zcodeUsage.session_count > 0) {
    const zu = data.zcodeUsage;
    lines.push("\nzcode usage:");
    lines.push(
      `  total: ${zu.total_tokens_input} in / ${zu.total_tokens_output} out / ${zu.total_tokens_reasoning} reasoning tokens over ${zu.session_count} sessions`,
    );
    if (zu.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of zu.by_model) {
        lines.push(
          `    ${m.model}: ${m.tokens_input} in / ${m.tokens_output} out`,
        );
      }
    }
  }

  // Claude Code usage (JSONL files)
  if (data.claudeCodeUsage && data.claudeCodeUsage.session_count > 0) {
    const cc = data.claudeCodeUsage;
    lines.push("\nclaude code usage:");
    lines.push(
      `  total: ${cc.total_tokens_input.toLocaleString()} in / ${cc.total_tokens_output.toLocaleString()} out / ${cc.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${cc.session_count} sessions`,
    );
    if (cc.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of cc.by_model) {
        lines.push(
          `    ${m.model}: ${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out`,
        );
      }
    }
  }

  return lines.join("\n");
}
