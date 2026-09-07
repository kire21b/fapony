import { execFileSync } from "node:child_process";
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  type Config,
  doneDirName,
  inboundWarnAt,
  linkScanDirs,
  loadConfig,
  shippedRE as shippedREFromConfig,
} from "./db/index.js";

export const SHIPPED_RE = /^>\s*✅\s*\*\*.*shipped.*\*\*/m;
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const ABSOLUTE_LINK_RE = /^(https?:|\/)/;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}-/;

/**
 * Pure-fs inbound-link scan (replaces `grep -rln`: works on Windows, skips
 * missing/unreadable dirs instead of failing the whole archive).
 * Returns repoRoot-relative paths with forward slashes (grep-style).
 */
function findInboundLinks(
  repoRoot: string,
  fileName: string,
  scanDirs: string[],
  doneName: string,
): string[] {
  const hits: string[] = [];
  const skipDirs = new Set([".git", "node_modules"]);
  const isDonePath = (p: string): boolean => p.split(sep).includes(doneName);
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing dir — skip, don't fail the archive
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (isDonePath(full)) continue;
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full);
      } else if (e.isFile()) {
        try {
          if (readFileSync(full, "utf-8").includes(fileName)) {
            hits.push(relative(repoRoot, full).split(sep).join("/"));
          }
        } catch {
          // unreadable file — skip
        }
      }
    }
  };
  for (const d of scanDirs) walk(resolve(repoRoot, d));
  return hits;
}

export interface PlanMvResult {
  ok: boolean;
  error?: string;
  inboundLinks?: string[];
  normalizedLinks?: number;
  // final filename in done/ (date-prefixed), so callers don't have to
  // recompute it just to report where the file landed.
  destName?: string;
}

// ponytail: archive-time date, not the shipped commit's date — the plan
// is archived right after shipping in the automated path (autoArchivePlan),
// so they're the same day in practice. Upgrade to `git show -s --format=%cs
// <hash>` on the shipped header's hash if manual/late archiving makes this drift.
function datePrefix(fileName: string): string {
  if (DATE_PREFIX_RE.test(fileName)) return fileName;
  return `${new Date().toISOString().slice(0, 10)}-${fileName}`;
}

/**
 * Validate + move a shipped PLAN to its own dir's done/ subfolder
 * (e.g. plan/PLAN-x.md -> plan/done/PLAN-x.md).
 *
 * Steps:
 * 1. Check shipped header present (anywhere in file; autoArchivePlan
 *    always prepends it at the top)
 * 2. Normalize relative links + add ../
 * 3. Check inbound links from other files
 * 4. git mv to <dir>/done/
 */
export function planMv(
  filePath: string,
  opts: { dryRun?: boolean; repoRoot?: string; config?: Config } = {},
): PlanMvResult {
  const { dryRun = false, repoRoot = process.cwd(), config } = opts;
  const shipped = config ? shippedREFromConfig(config) : SHIPPED_RE;
  const doneName = config ? doneDirName(config) : "done";

  // --- 1. Validate shipped header ---
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    return {
      ok: false,
      error: `cannot read plan file: ${(e as Error).message}`,
    };
  }
  if (!shipped.test(content)) {
    return {
      ok: false,
      error: `File does not have shipped header. Need: > ✅ **shipped** (<hash>) at the top of the file.`,
    };
  }

  // --- 2. Normalize + rewrite relative links ---
  const fileDir = dirname(resolve(filePath));
  const newDir = join(fileDir, doneName); // destination is <dir>/done/
  let normalizedCount = 0;
  const newContent = content.replace(LINK_RE, (match, text, href) => {
    if (ABSOLUTE_LINK_RE.test(href)) return match;

    // Resolve relative to file's current dir
    const target = resolve(fileDir, href);
    // New relative from .fapony/plan/done/ (one level deeper)
    const newHref = relative(newDir, target);

    if (href !== newHref) normalizedCount++;
    return `[${text}](${newHref})`;
  });

  // --- 3. Check inbound links ---
  const fileName = basename(filePath);
  const scanDirs = config
    ? linkScanDirs(config)
    : [".fapony/plan/", ".fapony/spec/", "docs/"];
  const inboundLinks = findInboundLinks(repoRoot, fileName, scanDirs, doneName);

  // --- 4. git mv (dest filename gets a YYYY-MM-DD- prefix) ---
  const destName = datePrefix(fileName);
  if (!dryRun) {
    const doneDir = newDir; // ponytail: bug fix — was hardcoded to .fapony/plan/done, ignoring file's own dir
    const dest = join(doneDir, destName);
    if (existsSync(dest)) {
      return {
        ok: false,
        error: `destination already exists: ${dest} — already archived?`,
      };
    }
    if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });

    // Write updated content if links were normalized
    if (normalizedCount > 0) {
      try {
        writeFileSync(filePath, newContent, "utf-8");
      } catch (e) {
        return {
          ok: false,
          error: `cannot rewrite links in plan file: ${(e as Error).message}`,
        };
      }
    }

    try {
      execFileSync("git", ["mv", filePath, dest], {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      return {
        ok: false,
        error:
          `git mv failed: ${(e as Error).message}` +
          (normalizedCount > 0
            ? " (note: relative links in the source file were already rewritten)"
            : ""),
      };
    }
  }

  return {
    ok: true,
    inboundLinks,
    normalizedLinks: normalizedCount,
    destName,
  };
}

/** CLI wrapper. */
export async function cmdPlanMv(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error("usage: fapony plan-mv <file>");
    process.exit(1);
  }

  const config = loadConfig();
  const result = planMv(filePath, { config });

  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.normalizedLinks) {
    console.log(`normalized ${result.normalizedLinks} link(s)`);
  }

  const warnAt = inboundWarnAt(config);
  if (result.inboundLinks?.length) {
    console.log(`\ninbound links to update (${result.inboundLinks.length}):`);
    for (const link of result.inboundLinks) {
      console.log(`  ${link}`);
    }
    if (result.inboundLinks.length > warnAt) {
      console.log(`  (more than ${warnAt} — report, don't fix yourself)`);
    }
  }

  const destName = result.destName ?? basename(filePath);
  console.log(
    `moved to ${relative(process.cwd(), join(dirname(resolve(filePath)), doneDirName(config), destName))}`,
  );
}
