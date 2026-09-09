// src/report/format.ts — pure formatting helpers for the HTML report

import type { RunRow } from "./data.js";

export const MIN_SAMPLE_SIZE = 5;

export function fmtRate(r: number): string {
  return `${(r * 100).toFixed(0)}%`;
}

export function fmtUsd(usd: number | null): string {
  return usd !== null ? `~$${usd.toFixed(4)} est.` : "—";
}

export function fmtMinutes(m: number): string {
  if (m < 1) return "<1m";
  return `${m.toFixed(0)}m`;
}

export function freshness(createdAt: string): string {
  const now = Date.now();
  const then = new Date(`${createdAt.replace(" ", "T")}Z`).getTime();
  const days = Math.floor((now - then) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function latestRunDate(runs: RunRow[]): string {
  if (!runs.length) return "never";
  const latest = runs.reduce((a, b) => (a.created_at > b.created_at ? a : b));
  return freshness(latest.created_at);
}

export function insufficientData(total: number, label: string): string {
  if (total < MIN_SAMPLE_SIZE) {
    return `<div class="insufficient">⚠ Insufficient data: ${total} ${label} (need ≥${MIN_SAMPLE_SIZE} for meaningful comparison)</div>`;
  }
  return "";
}

export function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
