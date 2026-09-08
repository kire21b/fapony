// src/parse.ts — parse structured markers from agent stdout.
// §0 rule: orchestrator ไม่อ่านข้อความอื่นเป็นคำสั่ง — marker เท่านั้น

import {
  type Config,
  fileDoneMarker,
  nextPromptMarker,
  verdictRE,
} from "./db/index.js";

/** Locked grade vocabulary — additive-only (append, never rename/remove). */
export type VerdictGrade =
  | "pass-excellent"
  | "pass-good"
  | "pass-adequate"
  | "pass"
  | "fail"
  | "uncertain";

export const VERDICT_GRADES: ReadonlySet<string> = new Set<VerdictGrade>([
  "pass-excellent",
  "pass-good",
  "pass-adequate",
  "pass",
  "fail",
  "uncertain",
]);

/** True when verdict belongs to the pass family (any pass-* variant). */
export function isPassFamily(v: string): v is VerdictGrade {
  return v.startsWith("pass");
}

/**
 * Locked qualityScore mapping — read-time only (never written to events).
 * Values from SPEC-verdict-protocol §qualityScore (additive-only, never change).
 */
const SCORE_MAP: Record<VerdictGrade, number> = {
  "pass-excellent": 5,
  "pass-good": 4,
  "pass-adequate": 3,
  pass: 3,
  fail: 0,
  uncertain: 1,
};

export function qualityScore(grade: VerdictGrade): number {
  return SCORE_MAP[grade] ?? 0;
}

export interface GateVerdict {
  verdict: VerdictGrade;
  note: string;
}

export interface PlanUpdate {
  kind: "next_prompt" | "file_done";
  text: string;
}

/**
 * Parse gate verdict from reviewer stdout.
 * Looks for `VERDICT: <grade>` as a standalone line where <grade> is one of
 * the 6 locked grades.  Everything after the verdict line is captured as
 * `note` (trimmed).  §0.4: if no VERDICT marker found → returns null.
 * Custom regex without a matching capture group also yields null (fail-safe).
 */
export function parseGateVerdict(
  stdout: string,
  config?: Config,
): GateVerdict | null {
  const re = verdictRE(config);
  const match = stdout.match(re);
  if (!match) return null;

  const raw = match[1];
  // Validate against locked set — reject custom regex returning garbage.
  if (!raw || !VERDICT_GRADES.has(raw)) return null;

  const idx = stdout.indexOf(match[0]);
  const note = stdout.slice(idx + match[0].length).trim();

  return { verdict: raw as VerdictGrade, note };
}

/**
 * Parse plan update from planner stdout.
 * Looks for the LAST occurrence of `## NEXT-PROMPT` or `## FILE_DONE`.
 * §0 rule: orchestrator ไม่อ่านข้อความอื่น — marker เท่านั้น
 * Returns null if neither marker found (§0.4 fail-safe)
 */
export function parsePlanUpdate(
  stdout: string,
  config?: Config,
): PlanUpdate | null {
  const nextMarker = nextPromptMarker(config);
  const doneMarker = fileDoneMarker(config);
  const nextPromptIdx = stdout.lastIndexOf(nextMarker);
  const fileDoneIdx = stdout.lastIndexOf(doneMarker);

  // Use whichever marker appears last (the "most final" output)
  if (nextPromptIdx === -1 && fileDoneIdx === -1) return null;

  const laterIdx = Math.max(nextPromptIdx, fileDoneIdx);
  const isNextPrompt = nextPromptIdx > fileDoneIdx;

  const marker = isNextPrompt ? nextMarker : doneMarker;
  const text = stdout.slice(laterIdx + marker.length).trim();

  if (!text) return null;

  return {
    kind: isNextPrompt ? "next_prompt" : "file_done",
    text,
  };
}

/**
 * Read a verdict back from a stored gate event (`kind='gate'`).
 * Gate events are JSON (`{verdict, note, round}` from gateOnce) — NOT
 * reviewer stdout, so parseGateVerdict's `VERDICT:` marker never matches
 * them. Returns null for missing/unparseable data or unknown grades.
 */
export function parseGateEventData(data: string | null): GateVerdict | null {
  if (!data) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { verdict, note } = parsed as { verdict?: unknown; note?: unknown };
  if (typeof verdict !== "string" || !VERDICT_GRADES.has(verdict)) return null;
  return {
    verdict: verdict as VerdictGrade,
    note: typeof note === "string" ? note : "",
  };
}
