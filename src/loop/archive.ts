// src/loop/archive.ts — auto-archive a shipped PLAN after FILE_DONE.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { shippedRE, archiveMsg, type Config } from "../db.js";
import { planMv, type PlanMvResult } from "../planmv.js";

/**
 * Auto-archive a shipped PLAN via planMv() — the FILE_DONE mirror of
 * bigFixer/scrutinizeFix's "reuse-not-rebuild" wiring.
 *
 * planMv() requires a file-level shipped header (`> ✅ **shipped** (<hash>)`)
 * at the top of the file; the planner only marks individual items shipped
 * inline (prompts/planner.md), so that header never exists yet at FILE_DONE
 * time. This synthesizes it from the current HEAD before calling planMv(),
 * then commits the archive (rename + header) in one step — deterministic,
 * no agent involved.
 */
export function autoArchivePlan(worktree: string, planRelPath: string, config?: Config): PlanMvResult {
  const filePath = join(worktree, planRelPath);
  const shipped = shippedRE(config);
  let hash: string;
  try {
    const content = readFileSync(filePath, "utf-8");
    if (!shipped.test(content)) {
      hash = execSync("git rev-parse --short HEAD", { cwd: worktree, encoding: "utf-8" }).trim();
      writeFileSync(filePath, `> ✅ **shipped** (${hash})\n\n${content}`, "utf-8");
    } else {
      hash = "existing";
    }
  } catch (e) {
    return { ok: false, error: `cannot prepare shipped header: ${(e as Error).message}` };
  }

  const result = planMv(filePath, { repoRoot: worktree, config });
  if (!result.ok) return result;

  try {
    const fileName = planRelPath.split("/").pop();
    const msg = config ? archiveMsg(config, fileName!, hash) : `chore(plan): archive ${fileName} (shipped ${hash})`;
    execSync(`git commit -m "${msg.replace(/"/g, "'")}"`, {
      cwd: worktree,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    return {
      ...result,
      ok: false,
      error: `moved to .fapony/plan/done/ but commit failed: ${(e as Error).message} — run: git commit`,
    };
  }

  return result;
}
