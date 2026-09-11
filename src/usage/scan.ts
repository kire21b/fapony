// src/usage/scan.ts — fapony usage-scan command
//
// Scans session logs for all four clients, writes usage-cache.jsonl.
// Windowed replace (30d default, all-time with --full) — never incremental.
// Progress bar on TTY, plain lines on pipe/CI.

import { loadConfig } from "../db/index.js";
import {
  readClaudeCodeUsage,
  readCodexUsage,
  readPassiveUsage,
  readZcodeUsage,
} from "../session/index.js";
import type { PassiveUsageResult } from "../session/types.js";
import {
  type CacheEntry,
  cacheMeta,
  mergeEntries,
  readCache,
  writeCache,
} from "./cache.js";

const DEFAULT_JSONL_LOOKBACK_DAYS = 30;

interface ScanTarget {
  key: string;
  label: string;
  scan: () => PassiveUsageResult;
}

function toCacheEntry(client: string, result: PassiveUsageResult): CacheEntry {
  return {
    client,
    scanned_at: new Date().toISOString(),
    session_count: result.session_count,
    total_tokens_input: result.total_tokens_input,
    total_tokens_output: result.total_tokens_output,
    total_tokens_reasoning: result.total_tokens_reasoning,
    total_tokens_cache_read: result.total_tokens_cache_read,
    total_tokens_cache_write: result.total_tokens_cache_write,
    total_cost: result.total_cost,
    by_model: result.by_model.map((m) => ({
      model: m.model,
      provider: m.provider,
      session_count: m.session_count,
      tokens_input: m.tokens_input,
      tokens_output: m.tokens_output,
      tokens_reasoning: m.tokens_reasoning,
      tokens_cache_read: m.tokens_cache_read,
      tokens_cache_write: m.tokens_cache_write,
      cost: m.cost,
    })),
  };
}

function progress(msg: string, isTTY: boolean): void {
  if (isTTY) {
    process.stderr.write(`\r\x1B[K${msg}`);
  } else {
    process.stderr.write(`${msg}\n`);
  }
}

export function cmdUsageScan(rawArgs: string[]): void {
  const full = rawArgs.includes("--full");
  const args = rawArgs.filter((a) => a !== "--full");
  const config = loadConfig();
  const isTTY = !!process.stderr.isTTY;

  if (args[0] && args[0] !== "--full") {
    console.error("usage: fapony usage-scan [--full]");
    process.exit(1);
  }

  // Windowed replace, never incremental merge.
  //
  // Every scan below returns a COMPLETE window (30d default, all-time with
  // --full) and mergeEntries() replaces the whole per-client entry — which is
  // only correct because no scan result is ever a delta. An incremental
  // `since = last_scanned_at` was tried and reverted: the readers aggregate
  // tokens at client/model level with no per-session token granularity, so a
  // delta cannot be merged back — sessions spanning the boundary double-count
  // and untouched history is lost outright (demonstrated: 1000 + 500 tokens
  // cached as 500). Correct incremental needs per-session ids in the readers;
  // until then, rescan the window behind the progress bar (scan waits, view
  // stays instant — the split this plan exists for).
  //
  // Units note: `since` is Unix seconds. The SQLite readers compare it
  // against millisecond time_created (helpers.ts buildWhereClause), so the
  // filter is a no-op there and SQLite scans are always full rescans — which
  // replace-semantics needs. Do NOT "fix" the units or re-add incremental
  // merging without per-session token granularity in the readers.
  const existing = readCache(config);

  const windowSince = full
    ? undefined
    : Date.now() / 1000 - DEFAULT_JSONL_LOOKBACK_DAYS * 86400;

  const targets: ScanTarget[] = [
    {
      key: "opencode",
      label: "opencode",
      scan: () =>
        readPassiveUsage(undefined, windowSince, undefined, {
          detail: false,
          full,
        }),
    },
    {
      key: "zcode",
      label: "zcode",
      scan: () =>
        readZcodeUsage(undefined, windowSince, undefined, false, full),
    },
    {
      key: "claude_code",
      label: "claude-code",
      scan: () => readClaudeCodeUsage(undefined, windowSince),
    },
    {
      key: "codex",
      label: "codex",
      scan: () => readCodexUsage(undefined, windowSince),
    },
  ];

  const entries: CacheEntry[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const pct = Math.round(((i + 1) / targets.length) * 100);
    const bar = `[${"█".repeat(Math.round(pct / 5))}${"░".repeat(20 - Math.round(pct / 5))}]`;
    progress(
      `${t.label}  ${bar}  ${i + 1}/${targets.length}  (${pct}%)`,
      isTTY,
    );

    try {
      const result = t.scan();
      if (result.session_count > 0) {
        entries.push(toCacheEntry(t.key, result));
      }
    } catch (err) {
      // Skip failed readers — don't crash the whole scan.
      if (isTTY) {
        process.stderr.write(`\n  ⚠ ${t.label}: ${err}\n`);
      } else {
        process.stderr.write(`  warn: ${t.label}: ${err}\n`);
      }
    }
  }

  // Merge with existing and write.
  const merged = mergeEntries(existing, entries);
  writeCache(merged, config);

  const finalMeta = cacheMeta(merged);
  if (isTTY) {
    process.stderr.write(
      `\r\x1B[Kscan done — ${finalMeta?.total_sessions ?? 0} sessions cached (${entries.length} clients updated)\n`,
    );
  } else {
    process.stderr.write(
      `scan done — ${finalMeta?.total_sessions ?? 0} sessions cached (${entries.length} clients updated)\n`,
    );
  }

  console.log(`cache written to ${cachePathHint(config)}`);
}

function cachePathHint(_config?: ReturnType<typeof loadConfig>): string {
  return "usage-cache.jsonl";
}
