// src/gates.ts — shared per-round gate enrichment (single implementation)
//
// Pairs each gate event with the spawn events in its own round window and
// derives model + cost + canonical quality. Used by stats, telemetry, and
// report-html — never reimplement this pairing elsewhere.
//
// Window rule (read-time join): per gate, cost/model come only from
// kind='spawn' events in (prevGateId, gateId) of the same run — per-round,
// never cumulative. Events arrive sorted (run_id, id), so one bucketing pass
// plus a forward spawn pointer over the disjoint windows is O(events) total.
//
// §0 rule: add-only — never remove or rename exported symbols.

import { sumSpawnCost } from "./cost.js";
import type { Event } from "./db/index.js";
import { qualityScore, VERDICT_GRADES, type VerdictGrade } from "./parse.js";
import { findSessionModel } from "./session/index.js";

export interface GateWindow {
  runId: number;
  /** Raw verdict string ("" when the gate event has none). */
  verdict: string;
  /** Canonical quality via qualityScore(), or null when grade unknown. */
  quality: number | null;
  /** Executor model from the window's spawns, or null when unknown. */
  model: string | null;
  /** USD estimate for the window's spawns, or null when unpriced/empty. */
  costUSD: number | null;
  /** Round number from the gate event data (defaults to 1). */
  round: number;
}

function parseEventData(data: string | null): Record<string, unknown> {
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Enrich every gate event with its per-round window.
 * One entry per gate event, in (run_id, id) order.
 */
export function enrichGateWindows(events: Event[]): GateWindow[] {
  const byRun = new Map<number, { gates: Event[]; spawns: Event[] }>();
  for (const e of events) {
    let b = byRun.get(e.run_id);
    if (!b) {
      b = { gates: [], spawns: [] };
      byRun.set(e.run_id, b);
    }
    if (e.kind === "gate") b.gates.push(e);
    else if (e.kind === "spawn") b.spawns.push(e);
  }

  const out: GateWindow[] = [];
  for (const [runId, b] of byRun) {
    let sp = 0;
    for (const g of b.gates) {
      // Pointer only moves forward; everything unconsumed below g.id belongs
      // to this gate's window (prevGateId is implicitly the last consumed id).
      const window: Event[] = [];
      while (sp < b.spawns.length && b.spawns[sp].id < g.id) {
        window.push(b.spawns[sp]);
        sp++;
      }
      const d = parseEventData(g.data);
      const verdict = typeof d.verdict === "string" ? d.verdict : "";
      const costUSD = window.length ? sumSpawnCost(window).usd_estimate : null;

      let model: string | null = null;
      for (const s of window) {
        const sd = parseEventData(s.data);
        if (
          sd.role === "executor" &&
          typeof sd.model === "string" &&
          sd.model
        ) {
          model = sd.model;
        }
      }

      // No spawn in window (the execute→review loop that wrote them is gone):
      // fall back to session_id on the gate event — resolve model from the
      // client's own session log. Spawn-based model always wins when present.
      if (model === null && typeof d.session_id === "string" && d.session_id) {
        const resolved = findSessionModel(d.session_id);
        if (resolved) model = resolved.model;
      }

      const grade = verdict as VerdictGrade;
      const quality = VERDICT_GRADES.has(grade) ? qualityScore(grade) : null;
      const round = typeof d.round === "number" ? d.round : 1;

      out.push({ runId, verdict, quality, model, costUSD, round });
    }
  }
  return out;
}
