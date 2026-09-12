// src/report/format.ts — pure formatting helpers for the HTML report

export const MIN_SAMPLE_SIZE = 5;

export function fmtRate(r: number): string {
  return `${(r * 100).toFixed(0)}%`;
}

export function fmtMinutes(m: number): string {
  if (m < 1) return "<1m";
  return `${m.toFixed(0)}m`;
}

export function insufficientData(total: number, label: string): string {
  if (total < MIN_SAMPLE_SIZE) {
    return `<div class="insufficient">⚠ Insufficient data: ${total} ${label} (need ≥${MIN_SAMPLE_SIZE} for meaningful comparison)</div>`;
  }
  return "";
}

/** Freshness label from an ISO-like timestamp. */
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

/** Freshness label from a StatsData.latestRunAt string. */
export function latestRunFreshness(latestRunAt: string): string {
  if (!latestRunAt) return "never";
  return freshness(latestRunAt);
}
