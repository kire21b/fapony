// src/usage/render.ts — HTML generator for usage-web

import { DEFAULT_TIMING_SAMPLE_LIMIT } from "../session/helpers.js";
import type { ModelBreakdown, PassiveUsageResult } from "../session/types.js";
import { esc, fmtCost, fmtTokens, shortModel } from "./format.js";

const FIELDS: (keyof ModelBreakdown)[] = [
  "tokens_input",
  "tokens_output",
  "tokens_cache_read",
  "tokens_cache_write",
  "tokens_reasoning",
  "session_count",
  "cost",
];

const HEADERS = [
  "Provider",
  "In",
  "Out",
  "Cache R",
  "Cache W",
  "Reason",
  "Sess",
  "Cost",
];

interface SummaryMetrics {
  sessions: number;
  cacheHitRate: number;
  reasoningPct: number;
  outputRatio: number;
  avgPerSession: number;
  totalCost: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  avgStepMs: number | null;
  avgStepInput: number | null;
  avgStepOutput: number | null;
}

function calcMetrics(d: PassiveUsageResult | null): SummaryMetrics {
  if (!d || d.session_count === 0)
    return {
      sessions: 0,
      cacheHitRate: 0,
      reasoningPct: 0,
      outputRatio: 0,
      avgPerSession: 0,
      totalCost: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      avgStepMs: null,
      avgStepInput: null,
      avgStepOutput: null,
    };
  const totalCache = d.total_tokens_cache_read + d.total_tokens_cache_write;
  const contextTokens = d.total_tokens_input + d.total_tokens_output;
  const t = d.detail?.timing;
  return {
    sessions: d.session_count,
    cacheHitRate: totalCache > 0 ? d.total_tokens_cache_read / totalCache : 0,
    reasoningPct:
      contextTokens > 0 ? d.total_tokens_reasoning / contextTokens : 0,
    outputRatio:
      d.total_tokens_input + d.total_tokens_output > 0
        ? d.total_tokens_output / (d.total_tokens_input + d.total_tokens_output)
        : 0,
    avgPerSession:
      d.session_count > 0
        ? Math.round(
            (d.total_tokens_input +
              d.total_tokens_output +
              d.total_tokens_reasoning) /
              d.session_count,
          )
        : 0,
    totalCost: d.total_cost,
    input: d.total_tokens_input,
    output: d.total_tokens_output,
    reasoning: d.total_tokens_reasoning,
    cacheRead: d.total_tokens_cache_read,
    avgStepMs: t?.avgStepMs ?? null,
    avgStepInput: t?.avgStepInput ?? null,
    avgStepOutput: t?.avgStepOutput ?? null,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function barHtml(value: number, max: number, color: string): string {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `<div class="bar"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>`;
}

function metric(
  label: string,
  value: string,
  cls: string,
  bar: string,
  wide = false,
): string {
  return `<div class="card-metric${wide ? " wide" : ""}">
    <div class="metric-label">${label}</div>
    <div class="metric-value ${cls}">${value}</div>
    ${bar}
  </div>`;
}

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function summaryCard(name: string, color: string, m: SummaryMetrics): string {
  if (m.sessions === 0)
    return `<div class="card" style="border-left-color:${color}">
      <div class="card-title" style="color:${color}">${name}</div>
      <div class="card-empty">no sessions</div>
    </div>`;
  const maxInput = Math.max(m.input, m.output, m.reasoning, 1);
  const timingMetrics =
    m.avgStepMs !== null ? metric("Avg Step", fmtMs(m.avgStepMs), "", "") : "";
  const stepTokenMetrics =
    m.avgStepInput !== null
      ? metric(
          "Step Tokens",
          `${fmtTokens(m.avgStepInput)} in / ${fmtTokens(m.avgStepOutput ?? 0)} out`,
          "",
          "",
        )
      : "";
  return `<div class="card" style="border-left-color:${color}">
  <div class="card-title" style="color:${color}">${name} <span class="sample">(${m.sessions} sessions)</span></div>
  <div class="card-metrics">
    ${metric("Cache Hit", pct(m.cacheHitRate), m.cacheHitRate > 0.7 ? "pass" : "warn", barHtml(m.cacheHitRate, 1, m.cacheHitRate > 0.7 ? "var(--green)" : "var(--yellow)"))}
    ${metric("Reasoning", pct(m.reasoningPct), m.reasoningPct > 0.15 ? "warn" : "pass", barHtml(m.reasoningPct, 1, m.reasoningPct > 0.15 ? "var(--red)" : "var(--green)"))}
    ${metric("Output", pct(m.outputRatio), "", barHtml(m.outputRatio, 1, m.outputRatio > 0.3 ? "var(--green)" : "var(--yellow)"))}
    ${metric("Input", fmtTokens(m.input), "", barHtml(m.input, maxInput, "var(--accent)"))}
    ${metric("Output", fmtTokens(m.output), "", barHtml(m.output, maxInput, "var(--green)"))}
    ${metric("Reasoning", fmtTokens(m.reasoning), m.reasoningPct > 0.15 ? "warn" : "", barHtml(m.reasoning, maxInput, "var(--yellow)"))}
    ${metric("Cache Read", fmtTokens(m.cacheRead), "", "")}
    ${metric("Avg/Session", fmtTokens(m.avgPerSession), "", "")}
    ${metric("Cost", fmtCost(m.totalCost), "", "", true)}
    ${timingMetrics}${stepTokenMetrics}
  </div>
</div>`;
}

function cell(
  d: ModelBreakdown | undefined,
  field: keyof ModelBreakdown,
): string {
  if (!d) return '<td class="muted">—</td>';
  const v = d[field];
  if (typeof v !== "number") return '<td class="muted">—</td>';
  if (field === "cost") return `<td>${fmtCost(v)}</td>`;
  return `<td>${fmtTokens(v)}</td>`;
}

function modelRows(data: PassiveUsageResult | null): string {
  if (!data || data.by_model.length === 0)
    return '    <tr><td class="muted" colspan="9">no sessions</td></tr>';
  return data.by_model
    .sort(
      (a, b) =>
        b.tokens_input +
        b.tokens_output +
        b.tokens_reasoning +
        b.tokens_cache_read +
        b.tokens_cache_write -
        (a.tokens_input +
          a.tokens_output +
          a.tokens_reasoning +
          a.tokens_cache_read +
          a.tokens_cache_write),
    )
    .map(
      (m) =>
        `    <tr data-model="${esc(m.model)}">
      <td class="model-name">${esc(shortModel(m.model))}</td>
      <td class="muted">${esc(m.provider || "—")}</td>
      ${FIELDS.map((f) => cell(m, f)).join("")}
    </tr>`,
    )
    .join("\n");
}

function totalsRow(data: PassiveUsageResult | null): string {
  if (!data || data.session_count === 0)
    return '    <tr class="totals"><td>Totals</td><td class="muted" colspan="8">no data</td></tr>';
  return `    <tr class="totals">
      <td>Totals</td>
      <td>${fmtTokens(data.total_tokens_input)}</td>
      <td>${fmtTokens(data.total_tokens_output)}</td>
      <td>${fmtTokens(data.total_tokens_cache_read)}</td>
      <td>${fmtTokens(data.total_tokens_cache_write)}</td>
      <td>${fmtTokens(data.total_tokens_reasoning)}</td>
      <td>${data.session_count}</td>
      <td>${fmtCost(data.total_cost)}</td>
    </tr>`;
}

function clientTable(
  id: string,
  name: string,
  color: string,
  data: PassiveUsageResult | null,
): string {
  return `
<h2 style="color:${color}">${name} <span class="sample">(${data?.session_count ?? 0} sessions)</span></h2>
<table id="${id}">
  <thead>
    <tr>
      <th>Model</th>
      ${HEADERS.map((h) => `<th>${h}</th>`).join("")}
    </tr>
  </thead>
  <tbody>
${modelRows(data)}
  </tbody>
  <tfoot>
${totalsRow(data)}
  </tfoot>
</table>`;
}

export function renderUsageHtml(
  opencode: PassiveUsageResult,
  zcode: PassiveUsageResult | null,
  claude_code: PassiveUsageResult | null,
  codex: PassiveUsageResult | null,
  pollInterval: number,
  ownerName?: string,
  full?: boolean,
): string {
  const oc = calcMetrics(opencode);
  const zc = calcMetrics(zcode);
  const cc = calcMetrics(claude_code);
  const cx = calcMetrics(codex);
  const owner = ownerName?.trim() ? esc(ownerName.trim()) : "";

  // Context share: proportion of total context tokens per client.
  const ctxTokens = [
    { name: "OpenCode", color: "var(--green)", tokens: oc.input + oc.output },
    { name: "ZCode", color: "var(--accent)", tokens: zc.input + zc.output },
    {
      name: "Claude Code",
      color: "var(--yellow)",
      tokens: cc.input + cc.output,
    },
    { name: "Codex", color: "var(--accent)", tokens: cx.input + cx.output },
  ];
  const ctxTotal = ctxTokens.reduce((s, c) => s + c.tokens, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fapony usage — live comparison${owner ? ` — ${owner}` : ""}</title>
<style>
  :root { --bg: #0d1117; --fg: #c9d1d9; --border: #30363d; --accent: #58a6ff; --green: #3fb950; --red: #f85149; --yellow: #d29922; --muted: #8b949e; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 960px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .owner { color: var(--muted); font-size: 0.9rem; font-weight: 400; white-space: nowrap; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .status.on { background: var(--green); }
  .status.off { background: var(--red); }
  .sample { font-size: 0.8rem; color: var(--muted); font-weight: 400; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0.5rem; font-size: 0.85rem; }
  th, td { padding: 0.4rem 0.6rem; text-align: right; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; position: sticky; top: 0; background: var(--bg); }
  td:first-child, th:first-child { text-align: left; }
  td.model-name { font-weight: 600; color: var(--fg); }
  tr:hover { background: #161b22; }
  .muted { color: var(--muted); }
  .totals { font-weight: 700; background: #161b22; }
  .totals td { border-top: 2px solid var(--border); }
  .flash { animation: flash 0.6s ease-out; }
  @keyframes flash { 0% { background: rgba(63,185,80,0.3); } 100% { background: transparent; } }
  .pass { color: var(--green); }
  .warn { color: var(--yellow); }
  .cards { display: flex; flex-direction: column; gap: 0.8rem; margin-bottom: 1.5rem; }
  .card { background: #161b22; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; padding: 0.8rem 1rem; }
  .card-title { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.5rem; }
  .card-empty { color: var(--muted); font-size: 0.85rem; }
  .card-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; }
  .card-metric { font-size: 0.8rem; }
  .card-metric.wide { grid-column: span 2; }
  .metric-label { color: var(--muted); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .metric-value { font-size: 0.95rem; font-weight: 700; color: var(--fg); }
  .bar { height: 3px; background: var(--border); border-radius: 2px; margin-top: 0.15rem; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
  .share-section { margin-bottom: 1.5rem; }
  .share-title { font-size: 0.85rem; color: var(--muted); margin-bottom: 0.4rem; }
  .share-bar { display: flex; height: 20px; border-radius: 4px; overflow: hidden; background: var(--border); }
  .share-seg { height: 100%; transition: width 0.3s; min-width: 1px; }
  .share-legend { display: flex; gap: 1rem; margin-top: 0.3rem; flex-wrap: wrap; }
  .share-item { font-size: 0.75rem; color: var(--fg); display: flex; align-items: center; gap: 0.3rem; }
  .share-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .footer { margin-top: 1.5rem; font-size: 0.8rem; color: var(--muted); text-align: center; }
</style>
</head>
<body>

<div class="header">
  <h1>fapony usage — live comparison <span class="owner">${
    full
      ? "(full scan)"
      : `(sampled — last 30d, ${DEFAULT_TIMING_SAMPLE_LIMIT.toLocaleString()} parts)`
  }</span></h1>
  ${owner ? `<span class="owner">${owner}</span>` : ""}
</div>
<div class="meta">
  <span class="status on" id="status-dot"></span>
  <span id="status-text">polling every ${pollInterval / 1000}s</span>
  <span>·</span>
  <span id="last-updated">${new Date().toISOString()}</span>
</div>

<div class="cards" id="summary-cards">
${summaryCard("OpenCode", "var(--green)", oc)}
${summaryCard("ZCode", "var(--accent)", zc)}
${summaryCard("Claude Code", "var(--yellow)", cc)}
${summaryCard("Codex", "var(--accent)", cx)}
</div>

<div class="share-section" id="context-share">
  <div class="share-title">context share (tokens)</div>
  <div class="share-bar" id="share-bar">
    ${
      ctxTotal > 0
        ? ctxTokens
            .map((c) => {
              const w = Math.round((c.tokens / ctxTotal) * 100);
              return w > 0
                ? `<div class="share-seg" style="width:${w}%;background:${c.color}" title="${c.name}: ${fmtTokens(c.tokens)}"></div>`
                : "";
            })
            .join("")
        : '<div class="share-seg" style="width:100%;background:var(--border)"></div>'
    }
  </div>
  <div class="share-legend" id="share-legend">
    ${ctxTokens
      .map((c) => {
        const pctStr =
          ctxTotal > 0 ? ((c.tokens / ctxTotal) * 100).toFixed(1) : "0.0";
        return `<span class="share-item"><span class="share-dot" style="background:${c.color}"></span>${c.name} ${pctStr}%</span>`;
      })
      .join("")}
  </div>
</div>

${clientTable("t-opencode", "OpenCode", "var(--green)", opencode)}
${clientTable("t-zcode", "ZCode", "var(--accent)", zcode)}
${clientTable("t-claude", "Claude Code", "var(--yellow)", claude_code)}
${clientTable("t-codex", "Codex", "var(--accent)", codex)}

<div class="footer">
  Tokens are approximate (byte proxy). Cost is estimate from static pricing, never a real charge.
</div>

<script>
(function() {
  var POLL_MS = ${pollInterval};

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
    return String(Math.round(n));
  }

  function fmtCost(n) {
    return n > 0 ? "~$" + n.toFixed(4) + " est." : "—";
  }

  function shortModel(raw) {
    try {
      var obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && typeof obj.id === "string") return obj.id;
    } catch(e) {}
    return raw;
  }

  function fmtMs(ms) {
    if (ms >= 60000) return (ms / 60000).toFixed(1) + "m";
    if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
    return Math.round(ms) + "ms";
  }

  function calcMetrics(d) {
    if (!d || d.session_count === 0) return null;
    var totalCache = d.total_tokens_cache_read + d.total_tokens_cache_write;
    var context = d.total_tokens_input + d.total_tokens_output;
    var t = d.detail && d.detail.timing ? d.detail.timing : null;
    return {
      sessions: d.session_count,
      cacheHitRate: totalCache > 0 ? d.total_tokens_cache_read / totalCache : 0,
      reasoningPct: context > 0 ? d.total_tokens_reasoning / context : 0,
      outputRatio: context > 0 ? d.total_tokens_output / context : 0,
      avgPerSession: Math.round(context / d.session_count),
      totalCost: d.total_cost,
      input: d.total_tokens_input,
      output: d.total_tokens_output,
      reasoning: d.total_tokens_reasoning,
      cacheRead: d.total_tokens_cache_read,
      avgStepMs: t && typeof t.avgStepMs === "number" ? t.avgStepMs : null,
      avgStepInput: t && typeof t.avgStepInput === "number" ? t.avgStepInput : null,
      avgStepOutput: t && typeof t.avgStepOutput === "number" ? t.avgStepOutput : null
    };
  }

  function pct(n) { return (n * 100).toFixed(1) + "%"; }

  function barFill(pct, color) {
    var w = Math.min(100, Math.round(pct * 100));
    return '<div class="bar"><div class="bar-fill" style="width:' + w + '%;background:' + color + '"></div></div>';
  }

  function metricItem(label, value, cls, bar, wide) {
    return '<div class="card-metric' + (wide ? ' wide' : '') + '">'
      + '<div class="metric-label">' + label + '</div>'
      + '<div class="metric-value ' + cls + '">' + value + '</div>'
      + bar
      + '</div>';
  }

  function updateCard(name, data) {
    var cards = document.getElementById("summary-cards");
    var cards_els = cards.querySelectorAll(".card");
    var idx = name === "opencode" ? 0 : name === "zcode" ? 1 : name === "claude_code" ? 2 : 3;
    var card = cards_els[idx];
    if (!card) return;
    var m = calcMetrics(data);
    if (!m) {
      card.querySelector(".card-title").innerHTML = name.charAt(0).toUpperCase() + name.slice(1) + ' <span class="sample">(0 sessions)</span>';
      card.querySelector(".card-metrics").innerHTML = '<div class="card-empty">no sessions</div>';
      return;
    }
    var title = name.charAt(0).toUpperCase() + name.slice(1).replace("_", " ");
    if (name === "claude_code") title = "Claude Code";
    if (name === "codex") title = "Codex";
    card.querySelector(".card-title").innerHTML = title + ' <span class="sample">(' + m.sessions + ' sessions)</span>';
    var maxInput = Math.max(m.input, m.output, m.reasoning, 1);
    card.querySelector(".card-metrics").innerHTML =
      metricItem("Cache Hit", pct(m.cacheHitRate), m.cacheHitRate > 0.7 ? "pass" : "warn", barFill(m.cacheHitRate, m.cacheHitRate > 0.7 ? "var(--green)" : "var(--yellow)"))
      + metricItem("Reasoning", pct(m.reasoningPct), m.reasoningPct > 0.15 ? "warn" : "pass", barFill(m.reasoningPct, m.reasoningPct > 0.15 ? "var(--red)" : "var(--green)"))
      + metricItem("Output", pct(m.outputRatio), "", barFill(m.outputRatio, m.outputRatio > 0.3 ? "var(--green)" : "var(--yellow)"))
      + metricItem("Input", fmt(m.input), "", barFill(m.input / maxInput, "var(--accent)"))
      + metricItem("Output", fmt(m.output), "", barFill(m.output / maxInput, "var(--green)"))
      + metricItem("Reasoning", fmt(m.reasoning), m.reasoningPct > 0.15 ? "warn" : "", barFill(m.reasoning / maxInput, "var(--yellow)"))
      + metricItem("Cache Read", fmt(m.cacheRead), "", "")
      + metricItem("Avg/Session", fmt(m.avgPerSession), "", "")
      + (m.avgStepMs !== null ? metricItem("Avg Step", fmtMs(m.avgStepMs), "", "") : "")
      + (m.avgStepInput !== null ? metricItem("Step Tokens", fmt(m.avgStepInput) + " in / " + fmt(m.avgStepOutput) + " out", "", "") : "")
      + metricItem("Cost", fmtCost(m.totalCost), "", "", true);
  }

  var COLORS = { opencode: "var(--green)", zcode: "var(--accent)", claude_code: "var(--yellow)", codex: "var(--accent)" };
  var LABELS = { opencode: "OpenCode", zcode: "ZCode", claude_code: "Claude Code", codex: "Codex" };

  function ctxTokens(d) {
    if (!d || d.session_count === 0) return 0;
    return d.total_tokens_input + d.total_tokens_output;
  }

  function updateShareBar(data) {
    var clients = ["opencode", "zcode", "claude_code", "codex"];
    var entries = clients.map(function(k) { return { key: k, tokens: ctxTokens(data[k]) }; });
    var total = entries.reduce(function(s, e) { return s + e.tokens; }, 0);
    var bar = document.getElementById("share-bar");
    var legend = document.getElementById("share-legend");
    if (!bar || !legend) return;
    var barHtml = "";
    var legendHtml = "";
    entries.forEach(function(e) {
      var w = total > 0 ? Math.round((e.tokens / total) * 100) : 0;
      if (w > 0) barHtml += '<div class="share-seg" style="width:' + w + '%;background:' + COLORS[e.key] + '" title="' + LABELS[e.key] + ': ' + fmt(e.tokens) + '"></div>';
      var p = total > 0 ? ((e.tokens / total) * 100).toFixed(1) : "0.0";
      legendHtml += '<span class="share-item"><span class="share-dot" style="background:' + COLORS[e.key] + '"></span>' + LABELS[e.key] + ' ' + p + '%</span>';
    });
    if (!barHtml) barHtml = '<div class="share-seg" style="width:100%;background:var(--border)"></div>';
    bar.innerHTML = barHtml;
    legend.innerHTML = legendHtml;
  }

  function buildTable(data) {
    var models = data ? data.by_model.slice().sort(function(a,b) { return (b.tokens_input + b.tokens_output + b.tokens_reasoning + b.tokens_cache_read + b.tokens_cache_write) - (a.tokens_input + a.tokens_output + a.tokens_reasoning + a.tokens_cache_read + a.tokens_cache_write); }) : [];
    var html = "";
    if (models.length === 0) {
      html = '<tr><td class="muted" colspan="9">no sessions</td></tr>';
    } else {
      models.forEach(function(m) {
        html += '<tr data-model="' + m.model.replace(/"/g,"&quot;") + '">'
          + '<td class="model-name">' + shortModel(m.model).replace(/</g,"&lt;") + '</td>'
          + '<td class="muted">' + (m.provider || "\u2014").replace(/</g,"&lt;") + '</td>'
          + '<td>' + fmt(m.tokens_input) + '</td>'
          + '<td>' + fmt(m.tokens_output) + '</td>'
          + '<td>' + fmt(m.tokens_cache_read) + '</td>'
          + '<td>' + fmt(m.tokens_cache_write) + '</td>'
          + '<td>' + fmt(m.tokens_reasoning) + '</td>'
          + '<td>' + m.session_count + '</td>'
          + '<td>' + fmtCost(m.cost) + '</td>'
          + '</tr>';
      });
    }
    if (!data || data.session_count === 0) {
      html += '<tr class="totals"><td>Totals</td><td class="muted" colspan="8">no data</td></tr>';
    } else {
      html += '<tr class="totals">'
        + '<td>Totals</td>'
        + '<td></td>'
        + '<td>' + fmt(data.total_tokens_input) + '</td>'
        + '<td>' + fmt(data.total_tokens_output) + '</td>'
        + '<td>' + fmt(data.total_tokens_cache_read) + '</td>'
        + '<td>' + fmt(data.total_tokens_cache_write) + '</td>'
        + '<td>' + fmt(data.total_tokens_reasoning) + '</td>'
        + '<td>' + data.session_count + '</td>'
        + '<td>' + fmtCost(data.total_cost) + '</td>'
        + '</tr>';
    }
    return html;
  }

  function updateSection(tableId, data) {
    var table = document.getElementById(tableId);
    if (!table) return;
    var html = buildTable(data);
    var split = html.split('<tr class="totals">');
    table.querySelector("tbody").innerHTML = split[0];
    var tfoot = table.querySelector("tfoot");
    tfoot.innerHTML = split[1] ? '<tr class="totals">' + split[1] : "";
    var h2 = table.previousElementSibling;
    if (h2 && h2.tagName === "H2") {
      var count = data ? data.session_count : 0;
      var span = h2.querySelector("span.sample");
      if (span) span.textContent = "(" + count + " sessions)";
    }
  }

  function fetchData() {
    fetch("/data").then(function(r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function(data) {
      document.getElementById("status-dot").className = "status on";
      document.getElementById("status-text").textContent = "polling every " + (POLL_MS/1000) + "s";
      updateSection("t-opencode", data.opencode);
      updateSection("t-zcode", data.zcode);
      updateSection("t-claude", data.claude_code);
      updateSection("t-codex", data.codex);
      updateCard("opencode", data.opencode);
      updateCard("zcode", data.zcode);
      updateCard("claude_code", data.claude_code);
      updateCard("codex", data.codex);
      updateShareBar(data);
      document.getElementById("last-updated").textContent = new Date().toISOString();
    }).catch(function() {
      document.getElementById("status-dot").className = "status off";
      document.getElementById("status-text").textContent = "offline — retrying";
    });
  }

  setInterval(fetchData, POLL_MS);
})();
</script>

</body>
</html>`;
}
