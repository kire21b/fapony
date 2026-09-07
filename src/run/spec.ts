// src/run/spec.ts — Source spec link parsing + file reader

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, sourceSpecRE } from "../db/index.js";

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/;

/** Parse Source spec link from plan header. Returns null if absent or text-only. */
export function parseSourceSpec(
  planText: string,
  config?: Config,
): string | null {
  const match = planText.match(sourceSpecRE(config));
  if (!match) return null;
  const raw = match[1].trim();
  const linkMatch = raw.match(LINK_RE);
  if (linkMatch) return linkMatch[2];
  if (raw.startsWith("ไม่มี")) return null;
  return raw;
}

/** Read spec file, truncate to maxLines, return content or null.
 *  `baseDir` is the directory to resolve relative `specPath` from (usually the plan file's dir). */
export function readSpec(
  baseDir: string,
  specPath: string,
  maxLines: number,
): string | null {
  const resolved = specPath.startsWith("/")
    ? specPath
    : join(baseDir, specPath);
  if (!existsSync(resolved)) return null;
  try {
    const content = readFileSync(resolved, "utf-8");
    const lines = content.split("\n");
    if (lines.length > maxLines) {
      return (
        lines.slice(0, maxLines).join("\n") +
        `\n\n... (truncated at ${maxLines} lines, ${lines.length - maxLines} omitted)`
      );
    }
    return content;
  } catch {
    return null;
  }
}
