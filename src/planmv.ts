import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, relative, resolve } from "node:path";

export const SHIPPED_RE = /^>\s*✅\s*\*\*.*shipped.*\*\*/m;
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const ABSOLUTE_LINK_RE = /^(https?:|\/)/;

export interface PlanMvResult {
  ok: boolean;
  error?: string;
  inboundLinks?: string[];
  normalizedLinks?: number;
}

/**
 * Validate + move a shipped PLAN to .fapony/plan/done/.
 *
 * Steps:
 * 1. Check shipped header covers the ENTIRE file
 * 2. Normalize relative links + add ../
 * 3. Check inbound links from other files
 * 4. git mv to .fapony/plan/done/
 */
export function planMv(
  filePath: string,
  opts: { dryRun?: boolean; repoRoot?: string } = {}
): PlanMvResult {
  const { dryRun = false, repoRoot = process.cwd() } = opts;

  // --- 1. Validate shipped header ---
  const content = readFileSync(filePath, "utf-8");
  if (!SHIPPED_RE.test(content)) {
    return {
      ok: false,
      error: `File does not have shipped header. Need: > ✅ **shipped** (<hash>) at the top of the file.`,
    };
  }

  // --- 2. Normalize + rewrite relative links ---
  const fileDir = dirname(resolve(filePath));
  const newDir = join(fileDir, "done"); // destination is .fapony/plan/done/
  let normalizedCount = 0;
  let newContent = content.replace(LINK_RE, (match, text, href) => {
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

  try {
    const output = execSync(
      ["grep", "-rln", "--", fileName, ".fapony/plan/", ".fapony/spec/", "docs/"],
      { cwd: repoRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    if (output) {
      inboundLinks.push(
        ...output.split("\n").filter((l) => !l.includes(".fapony/plan/done/"))
      );
    }
  } catch {}

  // --- 4. git mv ---
  if (!dryRun) {
    const doneDir = join(repoRoot, ".fapony", "plan", "done");
    if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });

    // Write updated content if links were normalized
    if (normalizedCount > 0) {
      writeFileSync(filePath, newContent, "utf-8");
    }

    const dest = join(doneDir, fileName);
    execSync(`git mv "${filePath}" "${dest}"`, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  return {
    ok: true,
    inboundLinks,
    normalizedLinks: normalizedCount,
  };
}

/** CLI wrapper. */
export async function cmdPlanMv(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error("usage: fapony plan-mv <file>");
    process.exit(1);
  }

  const result = planMv(filePath);

  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.normalizedLinks) {
    console.log(`normalized ${result.normalizedLinks} link(s)`);
  }

  if (result.inboundLinks?.length) {
    console.log(`\ninbound links to update (${result.inboundLinks.length}):`);
    for (const link of result.inboundLinks) {
      console.log(`  ${link}`);
    }
    if (result.inboundLinks.length > 5) {
      console.log("  (more than 5 — report, don't fix yourself)");
    }
  }

  console.log(`moved to .fapony/plan/done/${filePath.split("/").pop()}`);
}
