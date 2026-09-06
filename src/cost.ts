// src/cost.ts — byte-based cost measurement + model attribution.
//
// Byte counts are a declared proxy, not real token usage: no vendor API is
// consulted. USD is an estimate from static per-role pricing (per 1k tokens)
// via BYTES_PER_TOKEN, shown as "~$X est." — never a real charge.
//
// Storage: events.data only (kind='spawn', same row updated in place).
// No new table, no new event kind. pricing:null disables USD, never bytes.

import type { Database } from "bun:sqlite";
import {
  addEvent,
  updateEventData,
  pricingFor,
  roleModel,
  type Config,
  type Event,
} from "./db.js";

/** Proxy: bytes per token. Fixed for slice 1 — no per-role override (see PLAN-cost-routing §ไม่ทำ). */
export const BYTES_PER_TOKEN = 4;

export interface SpawnCost {
  role: string;
  model: string;
  bytes_in: number;
  bytes_out: number;
  /** USD estimate, or null when pricing is unset — never 0-as-fake. */
  usd_estimate: number | null;
}

export function byteLength(s: string): number {
  return Buffer.byteLength(s ?? "", "utf-8");
}

/** USD estimate from bytes + static pricing. Null pricing → null (no fake $0). */
export function estimateUsd(
  bytesIn: number,
  bytesOut: number,
  pricing: { inputPer1k: number; outputPer1k: number } | null
): number | null {
  if (!pricing) return null;
  const tokensIn = bytesIn / BYTES_PER_TOKEN;
  const tokensOut = bytesOut / BYTES_PER_TOKEN;
  return (tokensIn / 1000) * pricing.inputPer1k + (tokensOut / 1000) * pricing.outputPer1k;
}

/** Full spawn cost record for one agent invocation. */
export function buildSpawnCost(
  role: string,
  model: string,
  prompt: string,
  output: string,
  config: Config
): SpawnCost {
  const bytes_in = byteLength(prompt);
  const bytes_out = byteLength(output);
  return {
    role,
    model,
    bytes_in,
    bytes_out,
    usd_estimate: estimateUsd(bytes_in, bytes_out, pricingFor(config, role)),
  };
}

/**
 * Log a spawn start (role/model/bytes_in + caller extra like base_sha/plan),
 * returning the event id for endSpawn(). One row per spawn — ts stays at start
 * so spawn→route timing in stats keeps working.
 */
export function beginSpawn(
  db: Database,
  runId: number,
  config: Config,
  role: string,
  prompt: string,
  extra?: Record<string, unknown>
): number {
  return addEvent(db, runId, "spawn", {
    ...extra,
    role,
    model: roleModel(config, role),
    bytes_in: byteLength(prompt),
  });
}

/** Complete a spawn row with bytes_out + usd_estimate (in place, no new kind). */
export function endSpawn(
  db: Database,
  eventId: number,
  config: Config,
  role: string,
  output: string
): void {
  const bytes_out = byteLength(output);
  const patch: Record<string, unknown> = { bytes_out };
  const usd = estimateUsd(
    currentBytesIn(db, eventId),
    bytes_out,
    pricingFor(config, role)
  );
  if (usd !== null) patch.usd_estimate = usd;
  updateEventData(db, eventId, patch);
}

function currentBytesIn(db: Database, eventId: number): number {
  try {
    const row = db
      .prepare("SELECT data FROM events WHERE id = ?")
      .get(eventId) as { data: string | null } | null;
    const parsed = JSON.parse(row?.data ?? "{}") as { bytes_in?: unknown };
    return typeof parsed.bytes_in === "number" ? parsed.bytes_in : 0;
  } catch {
    return 0;
  }
}

export interface RunCost {
  spawns: number;
  bytes_in: number;
  bytes_out: number;
  /** Sum of usd_estimate over priced spawns, or null when none priced. */
  usd_estimate: number | null;
}

/** Aggregate cost across kind='spawn' events. Skips rows without byte fields. */
export function sumSpawnCost(events: Event[]): RunCost {
  let spawns = 0;
  let bytes_in = 0;
  let bytes_out = 0;
  let usd: number | null = null;
  for (const e of events) {
    if (e.kind !== "spawn" || !e.data) continue;
    let d: {
      bytes_in?: unknown;
      bytes_out?: unknown;
      usd_estimate?: unknown;
    };
    try {
      d = JSON.parse(e.data) as typeof d;
    } catch {
      continue;
    }
    if (typeof d.bytes_in !== "number") continue;
    spawns++;
    bytes_in += d.bytes_in;
    if (typeof d.bytes_out === "number") bytes_out += d.bytes_out;
    if (typeof d.usd_estimate === "number") usd = (usd ?? 0) + d.usd_estimate;
  }
  return { spawns, bytes_in, bytes_out, usd_estimate: usd };
}

/** One-line human summary. USD shown only when priced (never fake $0). */
export function formatCost(c: RunCost): string {
  const base = `${c.bytes_in} bytes in / ${c.bytes_out} bytes out over ${c.spawns} spawn${c.spawns === 1 ? "" : "s"}`;
  return c.usd_estimate !== null ? `${base} (~$${c.usd_estimate.toFixed(4)} est.)` : base;
}
