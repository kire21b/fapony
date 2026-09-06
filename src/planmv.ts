import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
 * 1. Check shipped header covers the ENTIRE file
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
  const content = readFileSync(filePath, "utf-8");
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
  const fileName = filePath.split("/").pop()!;
  const inboundLinks: string[] = [];
  const scanDirs = config
    ? linkScanDirs(config)
    : [".fapony/plan/", ".fapony/spec/", "docs/"];
  const doneFrag = `/${doneName}/`;

  try {
    const output = execFileSync("grep", ["-rln", "--", fileName, ...scanDirs], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (output) {
      inboundLinks.push(
        ...output.split("\n").filter((l) => !l.includes(doneFrag)),
      );
    }
  } catch {}

  // --- 4. git mv (dest filename gets a YYYY-MM-DD- prefix) ---
  const destName = datePrefix(fileName);
  if (!dryRun) {
    const doneDir = newDir; // ponytail: bug fix — was hardcoded to .fapony/plan/done, ignoring file's own dir
    if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });

    // Write updated content if links were normalized
    if (normalizedCount > 0) {
      writeFileSync(filePath, newContent, "utf-8");
    }

    const dest = join(doneDir, destName);
    execFileSync("git", ["mv", filePath, dest], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
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

  const destName = result.destName ?? filePath.split("/").pop()!;
  console.log(
    `moved to ${relative(process.cwd(), join(dirname(resolve(filePath)), doneDirName(config), destName))}`,
  );
}
