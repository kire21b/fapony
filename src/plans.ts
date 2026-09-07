// src/plans.ts — cwd → worktree resolution + pending plan scan.
// Shared by status (ps), run (short forms) and kickoff (key optional).

import type { Dirent } from "node:fs";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { Config } from "./db/index.js";
import { planDir, planExtensions, shippedRE } from "./db/index.js";

/** realpath of the deepest existing ancestor of p, with the non-existing tail
 * appended back — so matching works inside fresh worktrees too. */
function realpathBestEffort(p: string): string {
  let cur = p;
  for (;;) {
    try {
      return realpathSync(cur) + p.slice(cur.length);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p; // fs root reached — compare lexically
      cur = parent;
    }
  }
}

/** Worktree key whose configured path is cwd itself or an ancestor of cwd.
 * Returns null when cwd is outside every configured worktree. */
export function worktreeFromCwd(config: Config, cwd?: string): string | null {
  const from = realpathBestEffort(cwd ?? process.cwd());
  let best: { key: string; rel: string } | null = null;
  for (const [key, path] of Object.entries(config.worktrees)) {
    let abs: string;
    try {
      abs = realpathSync(path);
    } catch {
      continue; // worktree path missing on disk — skip
    }
    const rel = relative(abs, from);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      // prefer the deepest match (worktrees can be nested)
      if (!best || rel.length < best.rel.length) best = { key, rel };
    }
  }
  return best?.key ?? null;
}

/** Plan files in <worktree>/<planDir>/ that are not shipped and not in done/.
 * Sorted alphabetically so a numeric index (`fapony run 2`) is stable. */
export function pendingPlans(config: Config, worktree: string): string[] {
  const exts = planExtensions(config);
  const shipped = shippedRE(config);
  const planDirAbs = join(worktree, planDir(config));
  const pending: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(planDirAbs, { withFileTypes: true });
  } catch {
    return pending; // no plan dir → no pending plans
  }
  for (const entry of entries) {
    if (!entry.isFile() || !exts.some((e) => entry.name.endsWith(e))) continue;
    if (entry.name === "done") continue; // skip <planDir>/done/ subdir
    try {
      const content = readFileSync(join(planDirAbs, entry.name), "utf-8");
      if (!shipped.test(content)) pending.push(entry.name);
    } catch {}
  }
  return pending.sort();
}

export type PlanArgResolution =
  | { ok: true; worktreeKey: string; planPath: string }
  | { ok: false; error: string };

/** Resolve a short plan reference (filename prefix) against the pending
 * plans of a worktree. Numeric refs are never plan indices — a bare digit
 * on the CLI means run ID (see resolveRunArgs in run/cli.ts), so this never
 * treats one as an index; that ambiguity used to silently mis-resolve. */
export function resolvePlanArg(
  config: Config,
  worktreeKey: string,
  planRef: string,
): PlanArgResolution {
  const worktree = config.worktrees[worktreeKey];
  if (!worktree) {
    return {
      ok: false,
      error: `unknown worktree key: ${worktreeKey} (available: ${Object.keys(config.worktrees).join(", ")})`,
    };
  }
  const pending = pendingPlans(config, worktree);
  if (pending.length === 0) {
    return {
      ok: false,
      error: `no pending plans in ${worktree} — nothing to run`,
    };
  }

  const lower = planRef.toLowerCase();
  const matches = pending.filter((n) => n.toLowerCase().startsWith(lower));
  if (matches.length === 0) {
    return {
      ok: false,
      error: `no pending plan starts with "${planRef}" — pending: ${pending.join(", ")}`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `ambiguous prefix "${planRef}": ${matches.join(", ")}`,
    };
  }
  return {
    ok: true,
    worktreeKey,
    planPath: `${planDir(config)}/${matches[0]}`,
  };
}
