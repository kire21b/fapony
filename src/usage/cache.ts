// src/usage/cache.ts — JSONL usage cache
//
// One line per client (opencode / zcode / claude_code / codex).
// Stored in the fapony state dir (~/.config/fapony/usage-cache.jsonl).
// Atomic write: write to .tmp then rename.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { faponyDir } from "../db/load.js";
import type { Config } from "../db/types.js";

const CACHE_FILENAME = "usage-cache.jsonl";

export interface CacheEntry {
  client: string;
  scanned_at: string;
  session_count: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_tokens_reasoning: number;
  total_tokens_cache_read: number;
  total_tokens_cache_write: number;
  total_cost: number;
  by_model: {
    model: string;
    provider: string;
    session_count: number;
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
    tokens_cache_read: number;
    tokens_cache_write: number;
    cost: number;
  }[];
}

export interface CacheMeta {
  scanned_at: string;
  total_sessions: number;
}

export function cachePath(config?: Config): string {
  return join(faponyDir(config), CACHE_FILENAME);
}

/** Read all entries from the JSONL cache file. Returns [] when missing or empty. */
export function readCache(config?: Config): CacheEntry[] {
  const p = cachePath(config);
  if (!existsSync(p)) return [];

  try {
    const raw = readFileSync(p, "utf-8");
    if (!raw.trim()) return [];
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as CacheEntry);
  } catch {
    return [];
  }
}

/**
 * Write entries to the cache file atomically (temp + rename).
 * Creates the state dir when missing (fresh-machine first scan).
 */
export function writeCache(entries: CacheEntry[], config?: Config): void {
  const p = cachePath(config);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  const content = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, p);
}

/**
 * Merge new entry into existing cache entries.
 * Dedup by `client` — last write wins (newest scanned_at wins).
 */
export function mergeEntries(
  existing: CacheEntry[],
  updated: CacheEntry[],
): CacheEntry[] {
  const byClient = new Map<string, CacheEntry>();
  for (const e of existing) byClient.set(e.client, e);
  for (const e of updated) byClient.set(e.client, e);
  return Array.from(byClient.values());
}

/** Get the freshness metadata from cache (oldest scanned_at across clients). */
export function cacheMeta(entries: CacheEntry[]): CacheMeta | null {
  if (entries.length === 0) return null;
  let oldest = entries[0].scanned_at;
  let total = 0;
  for (const e of entries) {
    if (e.scanned_at < oldest) oldest = e.scanned_at;
    total += e.session_count;
  }
  return { scanned_at: oldest, total_sessions: total };
}
