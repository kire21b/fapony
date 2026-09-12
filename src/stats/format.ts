// src/stats/format.ts — formatStatsText() for CLI + MCP text mode

import type { ModelBreakdown } from "../session/index.js";
import type { StatsData } from "./data.js";

/**
 * One "by model" line. provider is part of the identity, not decoration:
 * OpenCode records the same id under different providers (mimo-v2.5 on
 * opencode-go and on xiaomi are two rows), so printing the id alone renders
 * them as one duplicated-looking model. session_count is printed because a
 * row can legitimately be all zeros — 145 big-pickle sessions recorded no
 * tokens at all — and without it a 0/0 line reads like a parse failure.
 */
function modelLine(m: ModelBreakdown, withCost: boolean): string {
  const name = `${m.provider ? `${m.provider}/` : ""}${m.model || "(no model id)"}`;
  const cost = withCost ? ` ($${m.cost.toFixed(4)})` : "";
  return (
    `    ${name}: ${m.session_count} sessions, ` +
    `${m.tokens_input.toLocaleString()} in / ${m.tokens_output.toLocaleString()} out${cost}`
  );
}

function fmtRate(r: number): string {
  return `${(r * 100).toFixed(0)}%`;
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

  lines.push(
    `avg exec time (spawn→route): ${data.stages.exec.avg.toFixed(1)}m over ${data.stages.exec.count} rounds`,
  );
  lines.push(
    `avg review turnaround (route→gate): ${data.stages.review.avg.toFixed(1)}m over ${data.stages.review.count} rounds`,
  );

  if (data.byModel.length > 0) {
    lines.push("\nby model:");
    lines.push(
      "  client | provider | model | agent | gates | fails | failRate | avgQuality",
    );
    lines.push(
      "  -------|----------|-------|-------|-------|-------|----------|-----------",
    );
    for (const m of data.byModel) {
      lines.push(
        `  ${m.client.padEnd(6)} | ${m.provider.padEnd(8)} | ${m.model.padEnd(5)} | ${m.agent.padEnd(5)} | ${String(m.gateCount).padStart(5)} | ${String(m.fails).padStart(5)} | ${fmtRate(m.failRate).padStart(8)} | ${m.avgQuality.toFixed(1).padStart(10)}`,
      );
    }
    const a = data.modelAttribution;
    if (a.inferred > 0 || a.none > 0) {
      lines.push(
        `  attribution: ${a.declared} declared, ${a.inferred} inferred from the live session, ${a.none} unknown`,
      );
    }
  }

  if (data.byGrade.length > 0) {
    lines.push("\nby grade:");
    lines.push("  grade | count");
    lines.push("  ------|------");
    for (const g of data.byGrade) {
      lines.push(`  ${g.grade.padEnd(14)} | ${String(g.count).padStart(5)}`);
    }
  }

  if (data.byWorktree.length > 0) {
    lines.push("\nby worktree:");
    lines.push("  worktree | runs | passed | stalled | pending");
    lines.push("  ---------|------|--------|---------|--------");
    for (const w of data.byWorktree) {
      const pending = w.pending === null ? "—" : String(w.pending);
      lines.push(
        `  ${w.worktree.padEnd(8)} | ${String(w.runs).padStart(4)} | ${String(w.passed).padStart(6)} | ${String(w.stalled).padStart(7)} | ${pending.padStart(7)}`,
      );
    }
  }

  if (data.byReasonCode.length > 0) {
    lines.push("\nby reason_code (non-pass gates only):");
    lines.push("  worktree | reason | count");
    lines.push("  ---------|--------|------");
    for (const r of data.byReasonCode.slice(0, 3)) {
      lines.push(
        `  ${r.worktree.padEnd(8)} | ${r.reason.padEnd(14)} | ${String(r.count).padStart(5)}`,
      );
    }
  }

  if (data.byFile.length > 0) {
    lines.push(
      "\nby file (graded touches — absence means unmeasured, not safe):",
    );
    lines.push("  file | gates | fails | last reason");
    lines.push("  -----|-------|-------|------------");
    for (const f of data.byFile.slice(0, 10)) {
      lines.push(
        `  ${f.file.padEnd(40)} | ${String(f.gates).padStart(5)} | ${String(f.fails).padStart(5)} | ${f.lastReason ?? "—"}`,
      );
    }
  }

  if (data.escalatedRuns.length > 0) {
    lines.push("\nescalated runs (round past cap — likely plan signal):");
    for (const e of data.escalatedRuns.slice(0, 3)) {
      lines.push(
        `  run ${e.id} (${e.worktree}, plan ${e.plan ?? "—"}): round ${e.round}`,
      );
    }
  }

  if (data.bestPassing.length > 0) {
    lines.push("\nplans passed at round 1 (reuse this shape):");
    for (const b of data.bestPassing.slice(0, 3)) {
      lines.push(`  ${b.plan} (${b.worktree})`);
    }
  }

  if (data.usage.session_count > 0) {
    lines.push("\nusage:");
    lines.push(
      `  total: ${data.usage.total_tokens_input} input / ${data.usage.total_tokens_output} output / ${data.usage.total_tokens_reasoning} reasoning tokens over ${data.usage.session_count} sessions ($${data.usage.total_cost.toFixed(4)})`,
    );
    if (data.usage.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of data.usage.by_model) lines.push(modelLine(m, true));
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
      for (const m of zu.by_model) lines.push(modelLine(m, false));
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
      for (const m of cc.by_model) lines.push(modelLine(m, false));
    }
  }

  // Codex usage (JSONL files)
  if (data.codexUsage && data.codexUsage.session_count > 0) {
    const cx = data.codexUsage;
    lines.push("\ncodex usage:");
    lines.push(
      `  total: ${cx.total_tokens_input.toLocaleString()} in / ${cx.total_tokens_output.toLocaleString()} out / ${cx.total_tokens_reasoning.toLocaleString()} reasoning tokens over ${cx.session_count} sessions`,
    );
    if (cx.by_model.length > 0) {
      lines.push("  by model:");
      for (const m of cx.by_model) lines.push(modelLine(m, false));
    }
  }

  return lines.join("\n");
}
