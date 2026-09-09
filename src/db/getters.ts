import {
  DEFAULT_MEMORY_ENTRY,
  DEFAULT_PLAN_DIR,
  DEFAULT_SAFETY_DENY,
  DEFAULT_SPEC_DIR,
} from "./defaults.js";
import type { Config, RolePricing } from "./types.js";

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
  if (typeof p.inputPer1k !== "number" || typeof p.outputPer1k !== "number")
    return null;
  return { inputPer1k: p.inputPer1k, outputPer1k: p.outputPer1k };
}
