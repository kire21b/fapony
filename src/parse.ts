// src/parse.ts — parse structured markers from agent stdout.
// §0 rule: orchestrator ไม่อ่านข้อความอื่นเป็นคำสั่ง — marker เท่านั้น

import {
  verdictRE,
  nextPromptMarker,
  fileDoneMarker,
  type Config,
} from "./db/index.js";

export interface GateVerdict {
  verdict: "pass" | "fail";
  note: string;
}

export interface PlanUpdate {
  kind: "next_prompt" | "file_done";
  text: string;
}

/**
 * Parse gate verdict from reviewer stdout.
 * Looks for `VERDICT: pass` or `VERDICT: fail` as a standalone line.
 * Everything after the verdict line is captured as `note` (trimmed).
 * §0.4: if no VERDICT marker found → returns null (caller must not guess)
 */
export function parseGateVerdict(stdout: string, config?: Config): GateVerdict | null {
  const re = verdictRE(config);
  const match = stdout.match(re);
  if (!match) return null;

  const verdict = match[1] as "pass" | "fail";
  const idx = stdout.indexOf(match[0]);
  const note = stdout.slice(idx + match[0].length).trim();

  return { verdict, note };
}

/**
 * Parse plan update from planner stdout.
 * Looks for the LAST occurrence of `## NEXT-PROMPT` or `## FILE_DONE`.
 * §0 rule: orchestrator ไม่อ่านข้อความอื่น — marker เท่านั้น
 * Returns null if neither marker found (§0.4 fail-safe)
 */
export function parsePlanUpdate(stdout: string, config?: Config): PlanUpdate | null {
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
