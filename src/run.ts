import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  openDb,
  loadConfig,
  newRun,
  setStatus,
  incrementRound,
  addEvent,
  getPendingFeedback,
  type Config,
  type RunStatus,
} from "./db.js";
import { gitFacts, parseHandoff, renderHandoff, type GitFacts, type ParsedHandoff } from "./handoff.js";
import { closeMemory, claimMemory } from "./memory.js";
import { assertSafe } from "./safety.js";
import { templateArgs } from "./util.js";

export interface RunOnceOpts {
  worktreeKey: string;
  planPath: string | null;
  planContent: string | null;
  memId: string | null;
  allowDirty: boolean;
}

const SPEC_RE = /^>\s*\*\*Source spec:\*\*\s*(.+)$/m;
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/;
const MAX_SPEC_LINES = 200;

/** Parse Source spec link from plan header. Returns null if absent or text-only (ไม่มี). */
function parseSourceSpec(planText: string): string | null {
  const match = planText.match(SPEC_RE);
  if (!match) return null;
  const raw = match[1].trim();
  // Check for markdown link [text](path)
  const linkMatch = raw.match(LINK_RE);
  if (linkMatch) return linkMatch[2]; // the path part
  // Text-only like "ไม่มี" — not a real spec
  if (raw.startsWith("ไม่มี")) return null;
  // Plain path without link syntax
  return raw;
}

/** Read spec file, truncate to MAX_SPEC_LINES, return content or null. */
function readSpec(worktree: string, specPath: string): string | null {
  // Resolve relative to worktree root
  const resolved = join(worktree, specPath);
  if (!existsSync(resolved)) return null;
  try {
    const content = readFileSync(resolved, "utf-8");
    const lines = content.split("\n");
    if (lines.length > MAX_SPEC_LINES) {
      return (
        lines.slice(0, MAX_SPEC_LINES).join("\n") +
        `\n\n... (truncated at ${MAX_SPEC_LINES} lines, ${lines.length - MAX_SPEC_LINES} omitted)`
      );
    }
    return content;
  } catch {
    return null;
  }
}

export interface RunOnceResult {
  runId: number;
  status: RunStatus;
  facts: GitFacts;
  parsed: ParsedHandoff;
  isBig: boolean;
  error?: string;
}

/**
 * Core run flow — does NOT call process.exit.
 * CLI wrapper (cmdRun) is responsible for exit codes.
 */
export async function runOnce(opts: RunOnceOpts): Promise<RunOnceResult> {
  const { worktreeKey, planPath, planContent: planContentOverride, memId, allowDirty } = opts;
  const config = loadConfig();
  const worktree = config.worktrees[worktreeKey];

  if (!worktree) {
    return {
      runId: 0,
      status: "stopped",
      facts: { files: 0, lines: 0, commits: [], branch: "" },
      parsed: { missing: true },
      isBig: false,
      error: `unknown worktree key: ${worktreeKey} (available: ${Object.keys(config.worktrees).join(", ")})`,
    };
  }

  // --- 1. GIT GUARD ---
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (porcelain && !allowDirty) {
      const dirtyFiles = porcelain.split("\n").slice(0, 10).join("\n");
      const more = porcelain.split("\n").length > 10
        ? `\n  ... and ${porcelain.split("\n").length - 10} more`
        : "";
      return {
        runId: 0,
        status: "stopped",
        facts: { files: 0, lines: 0, commits: [], branch: "" },
        parsed: { missing: true },
        isBig: false,
        error: `worktree has uncommitted changes:\n${dirtyFiles}${more}\n\nRe-run with --allow-dirty to proceed.`,
      };
    }
  } catch (e) {
    return {
      runId: 0,
      status: "stopped",
      facts: { files: 0, lines: 0, commits: [], branch: "" },
      parsed: { missing: true },
      isBig: false,
      error: `git status failed in ${worktree}: ${(e as Error).message}`,
    };
  }

  // --- 2. BASE SHA + INSERT RUN ---
  const baseSha = execSync("git rev-parse HEAD", {
    cwd: worktree,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  const db = openDb();
  const runId = newRun(db, worktreeKey, planPath, memId, baseSha);
  addEvent(db, runId, "spawn", { base_sha: baseSha, plan: planPath });

  console.error(`run ${runId} started (base ${baseSha.slice(0, 8)})`);

  // --- 3. MEMORY CLAIM (optional) ---
  if (memId) {
    try {
      const claimed = claimMemory(config, worktree, memId);
      if (claimed) {
        addEvent(db, runId, "memory_claim", { mem_id: memId });
        console.error(`memory claimed: ${memId}`);
      } else {
        console.error(`memory skipped (disabled or no .fapony/.memory/mem.ts): ${memId}`);
      }
    } catch (e) {
      console.error(`memory claim failed (non-fatal): ${(e as Error).message}`);
      addEvent(db, runId, "memory_claim_failed", {
        mem_id: memId,
        error: (e as Error).message,
      });
    }
  }

  // --- 4. RESOLVE PLAN CONTENT ---
  // Source 1: explicit planContent override (from loop/planner)
  // Source 2: plan file on disk
  // Source 3: fallback
  let planContent = planContentOverride;
  if (!planContent && planPath) {
    try {
      planContent = readFileSync(join(worktree, planPath), "utf-8");
    } catch {
      planContent = `(plan file not found: ${planPath})`;
    }
  }
  if (!planContent) planContent = "(no plan provided)";

  // --- 4b. SPEC INJECTION ---
  let specContent: string | null = null;
  if (planContent && planContent !== "(no plan provided)" && !planContent.startsWith("(plan file not found")) {
    const specPath = parseSourceSpec(planContent);
    if (specPath) {
      specContent = readSpec(worktree, specPath);
      if (specContent) console.error(`spec attached: ${specPath}`);
    }
  }

  // --- 5. SPAWN EXECUTOR ---
  const promptTemplate = readFileSync(
    join(import.meta.dir, "..", "prompts", "execute.md"),
    "utf-8"
  );
  const feedback = memId ? getPendingFeedback(db, worktreeKey, memId, runId) : null;
  if (feedback) console.error(`carrying forward review feedback from previous round`);

  const prompt = promptTemplate
    .replace("{{PLAN}}", planContent)
    .replace("{{MEM_ID}}", memId ?? "none")
    .replace("{{SPEC}}", specContent ?? "(no spec)")
    .replace("{{FEEDBACK}}", feedback ?? "(none — first round)");

  const executorCmd = templateArgs(config.executor.cmd, {
    id: memId ?? "none",
  });
  assertSafe(executorCmd);

  const timeoutMs = config.executor.timeoutMin * 60 * 1000;

  let stdout = "";
  let exitCode = 0;

  try {
    const proc = Bun.spawn(executorCmd, {
      cwd: worktree,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(prompt);
    await proc.stdin.end();

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const timeout = setTimeout(() => {
      proc.kill();
    }, timeoutMs);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      process.stdout.write(chunk);
    }

    clearTimeout(timeout);
    stdout = buffer;
    exitCode = await proc.exited;
  } catch (e) {
    console.error(`executor failed: ${(e as Error).message}`);
    exitCode = 1;
  }

  // --- TIMEOUT / EXIT CHECK ---
  if (exitCode !== 0) {
    setStatus(db, runId, "stalled");
    addEvent(db, runId, "stalled", { exit_code: exitCode });
    console.error(`\nfapony: run ${runId} stalled (exit ${exitCode})`);

    if (memId) closeMemory(config, worktree, memId, `run ${runId} stalled`);

    return {
      runId,
      status: "stalled",
      facts: { files: 0, lines: 0, commits: [], branch: "" },
      parsed: { missing: true },
      isBig: false,
    };
  }

  // --- 6. GIT FACTS + PARSE HANDOFF ---
  const facts = gitFacts(worktree, baseSha);
  const parsed = parseHandoff(stdout);

  for (const hash of facts.commits) {
    addEvent(db, runId, "commit", { hash });
  }

  // --- 7. ROUTE ---
  const isBig =
    facts.files > config.review.bigDiff.files ||
    facts.lines > config.review.bigDiff.lines;

  addEvent(db, runId, "route", { big: isBig, files: facts.files, lines: facts.lines });
  setStatus(db, runId, "awaiting_review");

  return { runId, status: "awaiting_review", facts, parsed, isBig };
}

/** CLI wrapper — calls runOnce and exits with appropriate code. */
export async function cmdRun(args: string[]): Promise<void> {
  const worktreeKey = args[0];
  if (!worktreeKey) {
    console.error("usage: fapony run <worktree-key> --plan <path> [--mem-id <id>] [--allow-dirty]");
    process.exit(1);
  }

  let planPath: string | null = null;
  let memId: string | null = null;
  let allowDirty = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      planPath = args[++i];
    } else if (args[i] === "--mem-id" && args[i + 1]) {
      memId = args[++i];
    } else if (args[i] === "--allow-dirty") {
      allowDirty = true;
    }
  }

  const result = await runOnce({ worktreeKey, planPath, planContent: null, memId, allowDirty });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  // Print handoff + next step (CLI-only output, loop handles this differently)
  const handoff = renderHandoff(result.facts, result.parsed);
  console.log("\n" + handoff);

  console.log("\n--- next step (run manually) ---");
  const config = loadConfig();
  const gate = config.review.gate.join(" ");
  console.log(
    `Route: ${result.isBig ? "big" : "small"} diff (${result.facts.files} files, ${result.facts.lines} lines)`
  );
  console.log(`Run review: ${gate}`);
  console.log(`After review: fapony status`);
  if (result.parsed.not_done?.length) {
    console.log(`\n⚠ not_done items: ${result.parsed.not_done.join("; ")}`);
  }
}
