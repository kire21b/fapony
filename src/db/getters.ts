import { join } from "node:path";
import type { Config, RolePricing } from "./types.js";
import {
  DEFAULT_SPEC_MAX_LINES,
  DEFAULT_PLAN_MAX_LINES,
  DEFAULT_SOURCE_MARKER,
  DEFAULT_HANDOFF_MARKER,
  DEFAULT_VERDICT_RE,
  DEFAULT_NEXT_PROMPT_MARKER,
  DEFAULT_FILE_DONE_MARKER,
  DEFAULT_SHIPPED_RE,
  DEFAULT_SAFETY_DENY,
  DEFAULT_PLAN_DIR,
  DEFAULT_SPEC_DIR,
  DEFAULT_MEMORY_ENTRY,
  DEFAULT_DONE_DIR,
  DEFAULT_LINK_SCAN_DIRS,
  DEFAULT_PLAN_EXTENSIONS,
  DEFAULT_ARCHIVE_MSG,
  DEFAULT_INBOUND_WARN_AT,
  DEFAULT_DIRTY_PREVIEW,
  DEFAULT_SHORT_SHA,
  DEFAULT_ROLE_TIMEOUTS,
} from "./defaults.js";

export function specMaxLines(config: Config): number {
  return config.spec?.maxLines ?? DEFAULT_SPEC_MAX_LINES;
}

export function planMaxLines(config?: Config): number {
  return config?.plan?.maxLines ?? DEFAULT_PLAN_MAX_LINES;
}

export function sourceSpecRE(config?: Config): RegExp {
  return new RegExp(config?.spec?.sourceMarker ?? DEFAULT_SOURCE_MARKER, "m");
}

export function handoffMarker(config?: Config): string {
  return config?.markers?.handoff ?? DEFAULT_HANDOFF_MARKER;
}

export function verdictRE(config?: Config): RegExp {
  return new RegExp(config?.markers?.verdict ?? DEFAULT_VERDICT_RE, "m");
}

export function nextPromptMarker(config?: Config): string {
  return config?.markers?.nextPrompt ?? DEFAULT_NEXT_PROMPT_MARKER;
}

export function fileDoneMarker(config?: Config): string {
  return config?.markers?.fileDone ?? DEFAULT_FILE_DONE_MARKER;
}

export function shippedRE(config?: Config): RegExp {
  return new RegExp(config?.markers?.shipped ?? DEFAULT_SHIPPED_RE, "m");
}

export function safetyDeny(config?: Config): string[] {
  return config?.safety?.deny ?? DEFAULT_SAFETY_DENY;
}

export function planDir(config?: Config): string {
  return config?.paths?.planDir ?? DEFAULT_PLAN_DIR;
}

export function specDir(config?: Config): string {
  return config?.paths?.specDir ?? DEFAULT_SPEC_DIR;
}

export function memoryEntry(config?: Config): string {
  return config?.paths?.memoryEntry ?? DEFAULT_MEMORY_ENTRY;
}

export function doneDirName(config?: Config): string {
  return config?.paths?.doneDir ?? DEFAULT_DONE_DIR;
}

export function linkScanDirs(config?: Config): string[] {
  return config?.paths?.linkScanDirs ?? DEFAULT_LINK_SCAN_DIRS;
}

export function planExtensions(config?: Config): string[] {
  return config?.plan?.extensions ?? DEFAULT_PLAN_EXTENSIONS;
}

export function archiveMsg(config: Config, file: string, hash: string): string {
  const tpl = config.planmv?.archiveMsg ?? DEFAULT_ARCHIVE_MSG;
  return tpl.replaceAll("{file}", file).replaceAll("{hash}", hash);
}

export function inboundWarnAt(config?: Config): number {
  return config?.planmv?.inboundWarnAt ?? DEFAULT_INBOUND_WARN_AT;
}

export function dirtyPreviewLines(config?: Config): number {
  return config?.display?.dirtyPreview ?? DEFAULT_DIRTY_PREVIEW;
}

export function shortShaLen(config?: Config): number {
  return config?.display?.shortSha ?? DEFAULT_SHORT_SHA;
}

/** Model attribution for a role: roles.<name>.model or "" when unset. */
export function roleModel(config: Config, role: string): string {
  return config.roles?.[role]?.model ?? "";
}

/**
 * Static pricing for a role, or null when unconfigured.
 * pricing:null (or missing role) disables USD only — byte measurement stays on.
 */
export function pricingFor(config: Config, role: string): RolePricing | null {
  const p = config.pricing?.[role];
  if (!p) return null;
  if (typeof p.inputPer1k !== "number" || typeof p.outputPer1k !== "number") return null;
  return { inputPer1k: p.inputPer1k, outputPer1k: p.outputPer1k };
}

/** Role spawn timeout (minutes): roles.<name>.timeoutMin > defaults.timeoutMin > builtin. */
export function roleTimeoutMin(config: Config, role: string): number {
  return (
    config.roles?.[role]?.timeoutMin ??
    config.defaults?.timeoutMin ??
    DEFAULT_ROLE_TIMEOUTS[role] ??
    10
  );
}

/**
 * Resolve a prompt template file for a role.
 * Returns null when the role has no configured/file prompt (caller uses inline fallback).
 * Relative paths resolve against the fapony repo root (cwd at runtime).
 */
export function promptFileFor(
  config: Config,
  role: "executor" | "gate" | "planner" | "bigFixer" | "scrutinizeFix"
): string | null {
  const p = config.prompts?.[role];
  if (!p) return null;
  if (p.startsWith("/")) return p;
  return join(process.cwd(), p);
}
