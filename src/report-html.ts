// src/report-html.ts — static HTML report from local run data (P5)
//
// Self-contained HTML with inline CSS/JS — no external dependencies.
// Filter by model, worktree, grade, status. Shows sample size + freshness.
// Displays "insufficient data" when sample is too small for conclusions.

import { writeFileSync } from "node:fs";
import { sumSpawnCost } from "./cost.js";
import { type Event, openDb, type Run } from "./db/index.js";

// ─── Data shapes ───────────────────────────────────────────────────────

interface RunRow {
  id: number;
  worktree: string;
  plan: string | null;
  status: string;
  round: number;
  created_at: string;
  updated_at: string;
}

interface GateRow {
  run_id: number;
  verdict: string;
  note: string;
  round: number;
  model: string;
  cost_usd: number | null;
}

interface ReportData {
  runs: RunRow[];
  gates: GateRow[];
  generated_at: string;
}

// ─── Data collection ───────────────────────────────────────────────────

function parseEventData(data: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function minutesBetween(a: string, b: string): number {
  const t0 = new Date(`${a.replace(" ", "T")}Z`).getTime();
  const t1 = new Date(`${b.replace(" ", "T")}Z`).getTime();
  return (t1 - t0) / 60000;
}

function collectData(): ReportData {
  const db = openDb();
  try {
    const runs = db.prepare("SELECT * FROM runs ORDER BY id").all() as Run[];
    const events = db
      .prepare("SELECT * FROM events ORDER BY run_id, id")
      .all() as Event[];

    // Enrich gate events with model + cost from preceding spawns
    const spawnEvents = events.filter((e) => e.kind === "spawn");
    const gateEvents = events.filter((e) => e.kind === "gate");

    const gates: GateRow[] = gateEvents.map((g) => {
      const gd = parseEventData(g.data);
      const verdict = typeof gd.verdict === "string" ? gd.verdict : "(unknown)";
      const note = typeof gd.note === "string" ? gd.note : "";

      // Find executor model from preceding spawns
      let model = "(unknown)";
      const precedingSpawns = spawnEvents.filter(
        (se) => se.run_id === g.run_id && se.id < g.id,
      );
      for (const se of precedingSpawns) {
        const sd = parseEventData(se.data);
        if (
          sd.role === "executor" &&
          typeof sd.model === "string" &&
          sd.model
        ) {
          model = sd.model;
        }
      }

      const cost = sumSpawnCost(precedingSpawns);

      return {
        run_id: g.run_id,
        verdict,
        note,
        round: typeof gd.round === "number" ? gd.round : 1,
        model,
        cost_usd: cost.usd_estimate,
      };
    });

    return {
      runs: runs.map((r) => ({
        id: r.id,
        worktree: r.worktree,
        plan: r.plan,
        status: r.status,
        round: r.round,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
      gates,
      generated_at: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

// ─── HTML generation ───────────────────────────────────────────────────

const MIN_SAMPLE_SIZE = 5;

function fmtRate(r: number): string {
  return `${(r * 100).toFixed(0)}%`;
}

function fmtUsd(usd: number | null): string {
  return usd !== null ? `~$${usd.toFixed(4)} est.` : "—";
}

function fmtMinutes(m: number): string {
  if (m < 1) return "<1m";
  return `${m.toFixed(0)}m`;
}

function freshness(createdAt: string): string {
  const now = Date.now();
  const then = new Date(`${createdAt.replace(" ", "T")}Z`).getTime();
  const days = Math.floor((now - then) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function latestRunDate(runs: RunRow[]): string {
  if (!runs.length) return "never";
  const latest = runs.reduce((a, b) => (a.created_at > b.created_at ? a : b));
  return freshness(latest.created_at);
}

function insufficientData(total: number, label: string): string {
  if (total < MIN_SAMPLE_SIZE) {
    return `<div class="insufficient">⚠ Insufficient data: ${total} ${label} (need ≥${MIN_SAMPLE_SIZE} for meaningful comparison)</div>`;
  }
  return "";
}

function renderHtml(data: ReportData): string {
  const { runs, gates, generated_at } = data;

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

  // Cost
  const totalCostUsd = gates.reduce(
    (s, g) => (g.cost_usd !== null ? s + g.cost_usd : s),
    0,
  );

  // By model
  const modelBuckets: Record<
    string,
    { count: number; qualities: number[]; costs: number[] }
  > = {};
  const scores: Record<string, number> = {
    "pass-excellent": 5,
    "pass-good": 4,
    "pass-adequate": 3,
    pass: 2,
    uncertain: 1,
    fail: 0,
  };
  for (const g of gates) {
    const b = (modelBuckets[g.model] ??= {
      count: 0,
      qualities: [],
      costs: [],
    });
    b.count++;
    const q = scores[g.verdict];
    if (q !== undefined) b.qualities.push(q);
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

  // By worktree
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
  .freshness { font-size: 0.75rem; color: var(--muted); }
  .sample { font-size: 0.8rem; color: var(--muted); }
  .no-data { text-align: center; padding: 3rem; color: var(--muted); }
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
  <div class="stat"><div class="value">${totalCostUsd > 0 ? fmtUsd(totalCostUsd) : "—"}</div><div class="label">total cost</div></div>
</div>

<h2>By Model <span class="sample">(n=${gates.length})</span></h2>
${insufficientData(gates.length, "gates")}
<table>
  <thead><tr><th>Model</th><th>Gates</th><th>Avg Quality</th><th>Avg Cost</th></tr></thead>
  <tbody>
${byModel
  .map(
    (m) => `    <tr>
      <td>${m.model}</td>
      <td>${m.count}</td>
      <td>${m.avgQuality.toFixed(1)} <span class="sample">/ 5</span></td>
      <td>${fmtUsd(m.avgCost)}</td>
    </tr>`,
  )
  .join("\n")}
  </tbody>
</table>

<h2>By Grade <span class="sample">(n=${gates.length})</span></h2>
<table>
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
    return `    <tr>
      <td class="${cls}">${g.grade}</td>
      <td>${g.count}</td>
      <td>${pct}%</td>
    </tr>`;
  })
  .join("\n")}
  </tbody>
</table>

<h2>By Worktree <span class="sample">(n=${runs.length})</span></h2>
<table>
  <thead><tr><th>Worktree</th><th>Runs</th><th>Passed</th><th>Stalled</th><th>Pass Rate</th></tr></thead>
  <tbody>
${byWorktree
  .map((w) => {
    const rate = w.runs ? w.passed / w.runs : 0;
    return `    <tr>
      <td>${w.worktree}</td>
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
    <li><strong>Quality score:</strong> pass-excellent=5, pass-good=4, pass-adequate=3, pass=2, uncertain=1, fail=0.</li>
    <li><strong>Cost:</strong> bytes are a proxy for tokens, USD is an estimate from static pricing — never a real charge.</li>
    <li><strong>Sample size:</strong> data with fewer than ${MIN_SAMPLE_SIZE} samples is flagged as insufficient for comparison.</li>
    <li><strong>Freshness:</strong> based on the most recent run creation timestamp.</li>
    <li><strong>Selection bias:</strong> this data represents your local workflow only — not a representative sample of all agent usage.</li>
    <li><strong>No content:</strong> no source code, diffs, plans, commit messages, or gate notes are included in this report.</li>
  </ul>
</div>

<div class="meta" style="margin-top: 1rem; text-align: center;">
  fapony verification report · generated from local SQLite · opt-in only
</div>

</body>
</html>`;
}

// ─── CLI ───────────────────────────────────────────────────────────────

export function cmdReportWeb(args: string[]): void {
  const data = collectData();
  const html = renderHtml(data);

  // Output to stdout or file
  const outFile = args[0];
  if (outFile) {
    writeFileSync(outFile, html, "utf-8");
    console.log(`report written to ${outFile}`);
  } else {
    console.log(html);
  }
}
