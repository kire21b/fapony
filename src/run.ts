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
  getEvents,
  specMaxLines,
  sourceSpecRE,
  handoffMarker,
  safetyDeny,
  dirtyPreviewLines,
  shortShaLen,
  promptFileFor,
  type Config,
  type RunStatus,
} from "./db/index.js";
import { gitFacts, parseHandoff, renderHandoff, type GitFacts, type ParsedHandoff } from "./handoff.js";
import { closeMemory, claimMemory } from "./memory.js";
import { assertSafe } from "./safety.js";
import { checkPlanHygiene } from "./planlint.js";
import { templateArgs } from "./util.js";
import { beginSpawn, endSpawn, sumSpawnCost } from "./cost.js";

export interface RunOnceOpts {
  worktreeKey: string;
  planPath: string | null;
  planContent: string | null;
  memId: string | null;
  allowDirty: boolean;
}

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/;

/** Parse Source spec link from plan header. Returns null if absent or text-only (ไม่มี). */
function parseSourceSpec(planText: string, config?: Config): string | null {
  const match = planText.match(sourceSpecRE(config));
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

/** Read spec file, truncate to maxLines, return content or null. */
function readSpec(worktree: string, specPath: string, maxLines: number): string | null {
  // Resolve relative to worktree root
  const resolved = join(worktree, specPath);
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

/**
 * Build the executor prompt from a template. Values are inserted via function
 * replacements so `$` sequences in plan/spec/feedback text are literal.
 */
export function buildExecutorPrompt(
  template: string,
  planContent: string,
  memId: string | null,
  specContent: string | null,
  feedback: string | null
): string {
  return template
    .replace("{{PLAN}}", () => planContent)
    .replace("{{MEM_ID}}", () => memId ?? "none")
    .replace("{{SPEC}}", () => specContent ?? "(no spec)")
    .replace("{{FEEDBACK}}", () => feedback ?? "(none — first round)");
}

/**
 * Executor spawn command: roles.executor.cmd wins when set ({{model}} filled
 * from roles.executor.model), otherwise the plain executor.cmd.
 */
export function executorCmd(
  config: Config,
  memId: string | null
): string[] {
  const role = config.roles?.executor;
  const cmd = role?.cmd ?? config.executor.cmd;
  return templateArgs(cmd, { id: memId ?? "none", model: role?.model ?? "" });
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
      const preview = dirtyPreviewLines(config);
      const all = porcelain.split("\n");
      const dirtyFiles = all.slice(0, preview).join("\n");
      const more = all.length > preview
        ? `\n  ... and ${all.length - preview} more`
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

  console.error(`run ${runId} started (base ${baseSha.slice(0, shortShaLen(config))})`);

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

  // --- 4a. PLAN HYGIENE (warn only — never blocks the run) ---
  if (planContent && planContent !== "(no plan provided)" && !planContent.startsWith("(plan file not found")) {
    for (const w of checkPlanHygiene(planContent, config)) {
      console.error(`⚠ plan hygiene: ${w.detail}`);
    }
  }

  // --- 4b. SPEC INJECTION ---
  let specContent: string | null = null;
  if (planContent && planContent !== "(no plan provided)" && !planContent.startsWith("(plan file not found")) {
    const specPath = parseSourceSpec(planContent, config);
    if (specPath) {
      specContent = readSpec(worktree, specPath, specMaxLines(config));
      if (specContent) console.error(`spec attached: ${specPath}`);
    }
  }

  // --- 5. SPAWN EXECUTOR ---
  const promptPath =
    promptFileFor(config, "executor") ??
    join(import.meta.dir, "..", "prompts", "execute.md");
  const promptTemplate = readFileSync(promptPath, "utf-8");
  const feedback = memId ? getPendingFeedback(db, worktreeKey, memId, runId) : null;
  if (feedback) console.error(`carrying forward review feedback from previous round`);

  const prompt = buildExecutorPrompt(promptTemplate, planContent, memId, specContent, feedback);

  const executorCmdArr = executorCmd(config, memId);
  assertSafe(executorCmdArr, safetyDeny(config));

  const timeoutMs = config.executor.timeoutMin * 60 * 1000;

  // Cost attribution: one spawn row (role/model/bytes_in now, bytes_out/usd on completion).
  const spawnEventId = beginSpawn(db, runId, config, "executor", prompt, {
    base_sha: baseSha,
    plan: planPath,
  });

  let stdout = "";
  let exitCode = 0;

  try {
    const proc = Bun.spawn(executorCmdArr, {
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

    // Drain stderr concurrently — if the pipe fills (64KB) while we only read
    // stdout, the executor blocks forever and we kill it as a false stall.
    const stderrDrain = new Response(proc.stderr).text();

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
    const errText = await stderrDrain;
    if (errText) process.stderr.write(errText);
    exitCode = await proc.exited;
  } catch (e) {
    console.error(`executor failed: ${(e as Error).message}`);
    exitCode = 1;
  }

  // --- TIMEOUT / EXIT CHECK ---
  if (exitCode !== 0) {
    endSpawn(db, spawnEventId, config, "executor", stdout);
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
  endSpawn(db, spawnEventId, config, "executor", stdout);
  const facts = gitFacts(worktree, baseSha);
  const parsed = parseHandoff(stdout, handoffMarker(config));

  // Persist the parsed handoff so `fapony handoff <run-id>` can reprint the
  // executor report later, not just git facts.
  addEvent(db, runId, "handoff", parsed);

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
  const config = loadConfig();
  let cost = undefined;
  if (result.runId) {
    const costDb = openDb();
    cost = sumSpawnCost(getEvents(costDb, result.runId));
    costDb.close();
  }
  const handoff = renderHandoff(result.facts, result.parsed, handoffMarker(config), cost);
  console.log("\n" + handoff);

  console.log("\n--- next step (run manually) ---");
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
