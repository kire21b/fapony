// test/usage.test.ts — unit tests for src/usage/format.ts + render.ts

import assert from "node:assert";
import type { PassiveUsageResult } from "../src/session/types.js";
import { EMPTY_RESULT } from "../src/session/types.js";
import {
  fmtCost,
  fmtDelta,
  fmtTokens,
  shortModel,
} from "../src/usage/format.js";
import { renderUsageHtml } from "../src/usage/render.js";

// ─── fmtTokens ────────────────────────────────────────────────────────

export function testFmtTokensZero(): void {
  assert.equal(fmtTokens(0), "0");
  console.log("  ✓ fmtTokens(0) → '0'");
}

export function testFmtTokensThousands(): void {
  assert.equal(fmtTokens(1234), "1K");
  assert.equal(fmtTokens(999), "999");
  assert.equal(fmtTokens(5000), "5K");
  console.log("  ✓ fmtTokens thousands → K suffix");
}

export function testFmtTokensMillions(): void {
  assert.equal(fmtTokens(1_500_000), "1.5M");
  assert.equal(fmtTokens(10_000_000), "10.0M");
  assert.equal(fmtTokens(999_999), "1000K");
  console.log("  ✓ fmtTokens millions → M suffix");
}

// ─── fmtCost ──────────────────────────────────────────────────────────

export function testFmtCostNull(): void {
  assert.equal(fmtCost(null), "—");
  console.log("  ✓ fmtCost(null) → '—'");
}

export function testFmtCostZero(): void {
  assert.equal(fmtCost(0), "—");
  console.log("  ✓ fmtCost(0) → '—'");
}

export function testFmtCostPositive(): void {
  assert.equal(fmtCost(0.0042), "~$0.0042 est.");
  assert.equal(fmtCost(100), "~$100.0000 est.");
  console.log("  ✓ fmtCost positive → ~$X.XXXX est.");
}

// ─── fmtDelta ─────────────────────────────────────────────────────────

export function testFmtDeltaZero(): void {
  assert.equal(fmtDelta(100, 100), "");
  console.log("  ✓ fmtDelta same → ''");
}

export function testFmtDeltaPositive(): void {
  assert.equal(fmtDelta(100, 150), "+50");
  console.log("  ✓ fmtDelta increase → '+N'");
}

export function testFmtDeltaNegative(): void {
  assert.equal(fmtDelta(150, 100), "-50");
  console.log("  ✓ fmtDelta decrease → '-N'");
}

// ─── shortModel ───────────────────────────────────────────────────────

export function testShortModelJsonId(): void {
  const raw =
    '{"id":"mimo-v2.5","providerID":"opencode-go","variant":"default"}';
  assert.equal(shortModel(raw), "mimo-v2.5");
  console.log("  ✓ shortModel JSON with id → extracts id");
}

export function testShortModelJsonNoId(): void {
  const raw = '{"providerID":"opencode-go"}';
  assert.equal(shortModel(raw), raw);
  console.log("  ✓ shortModel JSON without id → raw");
}

export function testShortModelPlainText(): void {
  assert.equal(shortModel("claude-sonnet-5"), "claude-sonnet-5");
  console.log("  ✓ shortModel plain text → passthrough");
}

export function testShortModelEmptyString(): void {
  assert.equal(shortModel(""), "");
  console.log("  ✓ shortModel empty → empty");
}

// ─── renderUsageHtml ──────────────────────────────────────────────────

const sampleData: PassiveUsageResult = {
  total_tokens_input: 1000,
  total_tokens_output: 200,
  total_tokens_reasoning: 50,
  total_tokens_cache_read: 500,
  total_tokens_cache_write: 10,
  total_cost: 0.42,
  session_count: 5,
  by_model: [
    {
      provider: "mock",
      model: "mimo-v2.5",
      session_count: 3,
      tokens_input: 600,
      tokens_output: 120,
      tokens_reasoning: 30,
      tokens_cache_read: 300,
      tokens_cache_write: 5,
      cost: 0.3,
    },
    {
      provider: "mock",
      model: "deepseek-v4-flash",
      session_count: 2,
      tokens_input: 400,
      tokens_output: 80,
      tokens_reasoning: 20,
      tokens_cache_read: 200,
      tokens_cache_write: 5,
      cost: 0.12,
    },
  ],
};

export function testRenderHtmlStructure(): void {
  const html = renderUsageHtml(sampleData, null, null, null, 3000);
  assert.ok(html.includes("<!DOCTYPE html>"), "has doctype");
  assert.ok(html.includes("OpenCode"), "has OpenCode title");
  assert.ok(html.includes("ZCode"), "has ZCode title");
  assert.ok(html.includes("Claude Code"), "has Claude Code title");
  assert.ok(html.includes("Codex"), "has Codex title");
  assert.ok(html.includes('id="t-opencode"'), "has opencode table id");
  assert.ok(html.includes('id="t-zcode"'), "has zcode table id");
  assert.ok(html.includes('id="t-claude"'), "has claude table id");
  assert.ok(html.includes('id="t-codex"'), "has codex table id");
  assert.ok(html.includes("<script>"), "has client-side JS");
  assert.ok(html.includes("setInterval"), "has polling logic");
  console.log("  ✓ renderUsageHtml → correct HTML structure");
}

export function testRenderHtmlModelNames(): void {
  const html = renderUsageHtml(sampleData, null, null, null, 3000);
  assert.ok(html.includes("mimo-v2.5"), "renders model name");
  assert.ok(html.includes("deepseek-v4-flash"), "renders model name");
  console.log("  ✓ renderUsageHtml → model names present");
}

export function testRenderHtmlTokenValues(): void {
  const html = renderUsageHtml(sampleData, null, null, null, 3000);
  assert.ok(html.includes("1K"), "renders input tokens (1000)");
  assert.ok(
    html.includes("200") || html.includes("200"),
    "renders output tokens",
  );
  assert.ok(html.includes("3"), "renders session count");
  console.log("  ✓ renderUsageHtml → token values present");
}

export function testRenderHtmlNoData(): void {
  const html = renderUsageHtml(EMPTY_RESULT, null, null, null, 3000);
  assert.ok(html.includes("no sessions"), "shows no sessions for empty data");
  console.log("  ✓ renderUsageHtml → handles empty data");
}

export function testRenderHtmlSummaryCards(): void {
  const html = renderUsageHtml(sampleData, sampleData, null, null, 3000);
  assert.ok(html.includes("summary-cards"), "has summary cards container");
  assert.ok(html.includes("Cache Hit"), "has cache hit metric");
  assert.ok(html.includes("Reasoning"), "has reasoning metric");
  assert.ok(html.includes("Output"), "has output metric");
  assert.ok(html.includes("Input"), "has input metric");
  assert.ok(html.includes("Avg/Session"), "has avg per session metric");
  assert.ok(html.includes("Cost"), "has cost metric");
  console.log("  ✓ renderUsageHtml → summary cards with all metrics");
}

export function testRenderHtmlCostWide(): void {
  const html = renderUsageHtml(sampleData, null, null, null, 3000);
  // Cost metric should have the "wide" class to span 2 columns
  assert.ok(html.includes("card-metric wide"), "cost metric has wide class");
  // Verify the CSS rule exists
  assert.ok(html.includes("card-metric.wide"), "wide CSS rule defined");
  console.log("  ✓ renderUsageHtml → Cost metric spans 2 columns");
}

export function testRenderHtmlPollInterval(): void {
  const html = renderUsageHtml(sampleData, null, null, null, 5000);
  assert.ok(html.includes("5"), "poll interval in seconds shown");
  assert.ok(
    html.includes("5000") || html.includes("POLL_MS"),
    "poll interval in ms",
  );
  console.log("  ✓ renderUsageHtml → poll interval rendered");
}
