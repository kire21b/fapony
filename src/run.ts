import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  openDb,
  loadConfig,
  newRun,
  setStatus,
  incrementRound,
  addEvent,
  type Config,
} from "./db.js";
import { gitFacts, parseHandoff, renderHandoff } from "./handoff.js";

const DANGEROUS_PATTERNS = [
  /reset\s+--hard/,
  /clean\s+-[a-z]*f/,
  /checkout\s+--\s/,
  /git\s+stash/,
];

function assertSafe(argv: string[]): void {
  const joined = argv.join(" ");
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(joined)) {
      throw new Error(`refusing to run dangerous command: ${joined}`);
    }
  }
}

function templateArgs(
  arr: string[],
  vars: Record<string, string>
): string[] {
  return arr.map((s) => {
    let out = s;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(`{${k}}`, v);
    }
    return out;
  });
}

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

  const config = loadConfig();
  const worktree = config.worktrees[worktreeKey];
  if (!worktree) {
    console.error(`unknown worktree key: ${worktreeKey}`);
    console.error(`available: ${Object.keys(config.worktrees).join(", ")}`);
    process.exit(1);
  }

  // --- 1. GIT GUARD ---
  // Check for unclean working tree
  try {
    const { execSync } = await import("node:child_process");
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
      console.error(
        `worktree has uncommitted changes (may be another agent's work):\n${dirtyFiles}${more}\n\nRe-run with --allow-dirty to proceed, or commit/stash first.`
      );
      process.exit(1);
    }
  } catch (e) {
    console.error(`git status failed in ${worktree}: ${(e as Error).message}`);
    process.exit(1);
  }

  // --- 2. BASE SHA + INSERT RUN ---
  const { execSync } = await import("node:child_process");
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
  if (memId && config.memory) {
    try {
      const claimCmd = templateArgs(config.memory.claim, { id: memId });
      assertSafe(claimCmd);
      const { execSync } = await import("node:child_process");
      execSync(claimCmd.join(" "), {
        cwd: worktree,
        stdio: ["pipe", "pipe", "pipe"],
      });
      addEvent(db, runId, "memory_claim", { mem_id: memId });
      console.error(`memory claimed: ${memId}`);
    } catch (e) {
      console.error(`memory claim failed (non-fatal): ${(e as Error).message}`);
      addEvent(db, runId, "memory_claim_failed", {
        mem_id: memId,
        error: (e as Error).message,
      });
    }
  }

  // --- 4. SPAWN EXECUTOR ---
  const promptTemplate = readFileSync(
    join(import.meta.dir, "..", "prompts", "execute.md"),
    "utf-8"
  );
  const planContent = planPath
    ? readFileSync(
        join(worktree, planPath),
        "utf-8"
      )
    : "(no plan provided)";
  const prompt = promptTemplate
    .replace("{{PLAN}}", planContent)
    .replace("{{MEM_ID}}", memId ?? "none");

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

    // Write prompt to stdin
    const writer = proc.stdin.getWriter();
    await writer.write(prompt);
    await writer.close();

    // Stream stdout
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
    exitCode = proc.exitCode ?? 1;
  } catch (e) {
    console.error(`executor failed: ${(e as Error).message}`);
    exitCode = 1;
  }

  // --- TIMEOUT / EXIT CHECK ---
  if (exitCode !== 0) {
    setStatus(db, runId, "stalled");
    addEvent(db, runId, "stalled", { exit_code: exitCode });
    console.error(`\nfapony: run ${runId} stalled (exit ${exitCode})`);

    // Release memory if claimed
    if (memId && config.memory) {
      try {
        const closeCmd = templateArgs(config.memory.close, {
          id: memId,
          msg: `run ${runId} stalled`,
        });
        assertSafe(closeCmd);
        const { execSync } = await import("node:child_process");
        execSync(closeCmd.join(" "), { cwd: worktree, stdio: "ignore" });
      } catch {}
    }
    process.exit(1);
  }

  // --- 5. GIT FACTS + PARSE HANDOFF ---
  const facts = gitFacts(worktree, baseSha);
  const parsed = parseHandoff(stdout);

  // Log all commits from this run
  for (const hash of facts.commits) {
    addEvent(db, runId, "commit", { hash });
  }

  // --- 6. ROUTE ---
  const isBig =
    facts.files > config.review.bigDiff.files ||
    facts.lines > config.review.bigDiff.lines;

  addEvent(db, runId, "route", { big: isBig, files: facts.files, lines: facts.lines });
  setStatus(db, runId, "awaiting_review");

  // --- 7. PRINT HANDOFF + NEXT STEP ---
  const handoff = renderHandoff(facts, parsed);
  console.log("\n" + handoff);

  console.log("\n--- next step (run manually) ---");
  const gate = config.review.gate.join(" ");
  console.log(
    `Route: ${isBig ? "big" : "small"} diff (${facts.files} files, ${facts.lines} lines)`
  );
  console.log(`Run review: ${gate}`);
  console.log(`After review: fapony status`);
  if (parsed.not_done?.length) {
    console.log(`\n⚠ not_done items: ${parsed.not_done.join("; ")}`);
  }
}
