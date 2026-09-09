// src/report/render.ts — HTML report rendering

import { minutesBetween } from "../math.js";
import type { ReportData } from "./data.js";
import {
  esc,
  fmtMinutes,
  fmtRate,
  fmtUsd,
  insufficientData,
  latestRunDate,
  MIN_SAMPLE_SIZE,
} from "./format.js";

/** Render report data as HTML. Exported for tests. */
export function renderReportHtml(data: ReportData): string {
  const { runs, gates, total_cost_usd, generated_at } = data;

  // Summary stats
  const totalRuns = runs.length;
  const terminal = runs.filter((r) =>
    ["passed", "stopped", "stalled"].includes(r.status),
  );
  const passed = runs.filter((r) => r.status === "passed");
  const passRate = terminal.length ? passed.length / terminal.length : 0;
  const stallRate = terminal.length
    ? runs.filter((r) => r.status === "stalled").length / terminal.length
    : 0;
  const avgRounds = passed.length
    ? passed.reduce((s, r) => s + r.round, 0) / passed.length
    : 0;
  const avgMinutes = passed.length
    ? passed.reduce(
        (s, r) => s + minutesBetween(r.created_at, r.updated_at),
        0,
      ) / passed.length
    : 0;

  // By model (quality carried from the shared gate helper — canonical)
  const modelBuckets: Record<
    string,
    { count: number; qualities: number[]; costs: number[] }
  > = {};
  for (const g of gates) {
    const b = (modelBuckets[g.model] ??= {
      count: 0,
      qualities: [],
      costs: [],
    });
    b.count++;
    if (g.quality !== null) b.qualities.push(g.quality);
    if (g.cost_usd !== null) b.costs.push(g.cost_usd);
  }
  const byModel = Object.entries(modelBuckets)
    .map(([model, b]) => ({
      model,
      count: b.count,
      avgQuality: b.qualities.length
        ? b.qualities.reduce((s, x) => s + x, 0) / b.qualities.length
        : 0,
      avgCost: b.costs.length
        ? b.costs.reduce((s, x) => s + x, 0) / b.costs.length
        : null,
    }))
    .sort((a, b) => b.count - a.count);

  // By grade
  const gradeBuckets: Record<string, number> = {};
  for (const g of gates)
    gradeBuckets[g.verdict] = (gradeBuckets[g.verdict] ?? 0) + 1;
  const byGrade = Object.entries(gradeBuckets)
    .map(([grade, count]) => ({ grade, count }))
    .sort((a, b) => b.count - a.count);

  // By worktree (basenames — see methodology note on collisions)
  const wtBuckets: Record<
    string,
    { runs: number; passed: number; stalled: number }
  > = {};
  for (const r of runs) {
    const name = r.worktree.split("/").pop() ?? r.worktree;
    const b = (wtBuckets[name] ??= { runs: 0, passed: 0, stalled: 0 });
    b.runs++;
    if (r.status === "passed") b.passed++;
    if (r.status === "stalled") b.stalled++;
  }
  const byWorktree = Object.entries(wtBuckets)
    .map(([worktree, b]) => ({ worktree, ...b }))
    .sort((a, b) => b.runs - a.runs);

  const models = [...new Set(byModel.map((m) => m.model))];
  const grades = [...new Set(byGrade.map((g) => g.grade))];
  const worktrees = [...new Set(byWorktree.map((w) => w.worktree))];

  const optionAll = `<option value="">all</option>`;
  const options = (xs: string[]) =>
    optionAll +
    xs.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fapony report — ${generated_at.split("T")[0]}</title>
<style>
  :root { --bg: #0d1117; --fg: #c9d1d9; --border: #30363d; --accent: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922; --muted: #8b949e; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; color: var(--accent); margin: 1.5rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .stat { background: #161b22; border: 1px solid var(--border); border-radius: 6px; padding: 1rem; text-align: center; }
  .stat .value { font-size: 1.8rem; font-weight: 700; color: var(--accent); }
  .stat .label { font-size: 0.8rem; color: var(--muted); margin-top: 0.3rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.9rem; }
  th, td { padding: 0.5rem 0.8rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; }
  tr:hover { background: #161b22; }
  .pass { color: var(--green); }
  .fail { color: var(--red); }
  .warn { color: var(--yellow); }
  .insufficient { background: #1c1917; border: 1px solid var(--yellow); border-radius: 6px; padding: 0.8rem 1rem; margin: 0.5rem 0; font-size: 0.9rem; color: var(--yellow); }
  .methodology { background: #161b22; border: 1px solid var(--border); border-radius: 6px; padding: 1.2rem; margin-top: 1.5rem; font-size: 0.85rem; color: var(--muted); }
  .methodology h3 { color: var(--fg); font-size: 0.95rem; margin-bottom: 0.5rem; }
  .methodology ul { padding-left: 1.5rem; }
  .methodology li { margin-bottom: 0.3rem; }
  .sample { font-size: 0.8rem; color: var(--muted); }
  .filters { display: flex; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 1rem; align-items: end; }
  .filters label { font-size: 0.85rem; color: var(--muted); display: flex; flex-direction: column; gap: 0.2rem; }
  .filters select { background: #161b22; color: var(--fg); border: 1px solid var(--border); border-radius: 4px; padding: 0.3rem 0.5rem; font-size: 0.85rem; }
</style>
</head>
<body>

<h1>fapony verification report</h1>
<div class="meta">
  Generated: ${generated_at} · Latest data: ${latestRunDate(runs)} · Schema v2
</div>

<h2>Summary</h2>
${insufficientData(totalRuns, "runs")}
<div class="summary">
  <div class="stat"><div class="value">${totalRuns}</div><div class="label">total runs</div></div>
  <div class="stat"><div class="value ${passRate >= 0.8 ? "pass" : passRate >= 0.5 ? "warn" : "fail"}">${fmtRate(passRate)}</div><div class="label">pass rate</div></div>
  <div class="stat"><div class="value ${stallRate <= 0.1 ? "pass" : "fail"}">${fmtRate(stallRate)}</div><div class="label">stall rate</div></div>
  <div class="stat"><div class="value">${avgRounds.toFixed(1)}</div><div class="label">avg rounds</div></div>
  <div class="stat"><div class="value">${fmtMinutes(avgMinutes)}</div><div class="label">avg time</div></div>
  <div class="stat"><div class="value">${total_cost_usd > 0 ? fmtUsd(total_cost_usd) : "—"}</div><div class="label">total cost</div></div>
</div>

<div class="filters">
  <label>model <select id="f-model">${options(models)}</select></label>
  <label>grade <select id="f-grade">${options(grades)}</select></label>
  <label>worktree <select id="f-worktree">${options(worktrees)}</select></label>
</div>

<h2>By Model <span class="sample">(n=${gates.length})</span></h2>
${insufficientData(gates.length, "gates")}
<table id="t-model">
  <thead><tr><th>Model</th><th>Gates</th><th>Avg Quality</th><th>Avg Cost</th></tr></thead>
  <tbody>
${byModel
  .map(
    (m) => `    <tr data-model="${esc(m.model)}">
      <td>${esc(m.model)}</td>
      <td>${m.count}</td>
      <td>${m.avgQuality.toFixed(1)} <span class="sample">/ 5</span></td>
      <td>${fmtUsd(m.avgCost)}</td>
    </tr>`,
  )
  .join("\n")}
  </tbody>
</table>

<h2>By Grade <span class="sample">(n=${gates.length})</span></h2>
<table id="t-grade">
  <thead><tr><th>Grade</th><th>Count</th><th>%</th></tr></thead>
  <tbody>
${byGrade
  .map((g) => {
    const pct = gates.length
      ? ((g.count / gates.length) * 100).toFixed(0)
      : "0";
    const cls = g.grade.startsWith("pass")
      ? "pass"
      : g.grade === "fail"
        ? "fail"
        : "warn";
    return `    <tr data-grade="${esc(g.grade)}">
      <td class="${cls}">${esc(g.grade)}</td>
      <td>${g.count}</td>
      <td>${pct}%</td>
    </tr>`;
  })
  .join("\n")}
  </tbody>
</table>

<h2>By Worktree <span class="sample">(n=${runs.length})</span></h2>
<table id="t-worktree">
  <thead><tr><th>Worktree</th><th>Runs</th><th>Passed</th><th>Stalled</th><th>Pass Rate</th></tr></thead>
  <tbody>
${byWorktree
  .map((w) => {
    const rate = w.runs ? w.passed / w.runs : 0;
    return `    <tr data-worktree="${esc(w.worktree)}">
      <td>${esc(w.worktree)}</td>
      <td>${w.runs}</td>
      <td class="pass">${w.passed}</td>
      <td class="fail">${w.stalled}</td>
      <td class="${rate >= 0.8 ? "pass" : rate >= 0.5 ? "warn" : "fail"}">${fmtRate(rate)}</td>
    </tr>`;
  })
  .join("\n")}
  </tbody>
</table>

<div class="methodology">
  <h3>Methodology</h3>
  <ul>
    <li><strong>Pass rate:</strong> passed / (passed + stopped + stalled) — terminal runs only, running/awaiting_review excluded.</li>
    <li><strong>Quality score:</strong> pass-excellent=5, pass-good=4, pass-adequate=3, pass=3 (legacy), uncertain=1, fail=0 — the same canonical mapping <code>fapony stats</code> uses.</li>
    <li><strong>Cost:</strong> bytes are a proxy for tokens, USD is an estimate from static pricing — never a real charge. Totals count each spawn once, per-round windows never overlap.</li>
    <li><strong>Sample size:</strong> data with fewer than ${MIN_SAMPLE_SIZE} samples is flagged as insufficient for comparison.</li>
    <li><strong>Freshness:</strong> based on the most recent run creation timestamp.</li>
    <li><strong>Worktree names:</strong> paths are redacted to basenames; two different paths sharing a basename merge into one row.</li>
    <li><strong>Selection bias:</strong> this data represents your local workflow only — not a representative sample of all agent usage.</li>
    <li><strong>No content:</strong> no source code, diffs, plans, commit messages, or gate notes are included in this report.</li>
  </ul>
</div>

<div class="meta" style="margin-top: 1rem; text-align: center;">
  fapony verification report · generated from local SQLite · opt-in only
</div>

<script>
(function () {
  function bind(selectId, tableId, attr) {
    var sel = document.getElementById(selectId);
    var rows = document.querySelectorAll("#" + tableId + " tbody tr");
    sel.addEventListener("change", function () {
      var v = sel.value;
      rows.forEach(function (r) {
        r.style.display = !v || r.getAttribute(attr) === v ? "" : "none";
      });
    });
  }
  bind("f-model", "t-model", "data-model");
  bind("f-grade", "t-grade", "data-grade");
  bind("f-worktree", "t-worktree", "data-worktree");
})();
</script>

</body>
</html>`;
}
