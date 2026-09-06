// src/setup.ts — interactive wizard: config + scaffold in one step.
// Replaces the manual cp + edit + init flow.

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { initProject } from "./init.js";
import { isAffirmative } from "./util.js";

function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultVal?: string,
): Promise<string> {
  return new Promise((resolve) => {
    const suffix = defaultVal !== undefined ? ` (${defaultVal})` : "";
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

function detectGitRoot(): string | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
    return root;
  } catch {
    return null;
  }
}

export function splitCmd(input: string): string[] {
  return (input.match(/"[^"]*"|\S+/g) ?? []).map((s) =>
    s.replace(/^"|"$/g, ""),
  );
}

function checkCmd(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export interface SetupAnswers {
  worktreeName: string;
  worktreePath: string;
  executorCmd: string[];
  executorTimeout: number;
  gateCmd: string[];
  autoLoop: boolean;
  enableMemory: boolean;
}

/** Pure config builder — the config-write path of cmdSetup, minus prompting. */
export function buildSetupConfig(a: SetupAnswers): Record<string, unknown> {
  const config: Record<string, unknown> = {
    worktrees: { [a.worktreeName]: a.worktreePath },
    executor: { cmd: a.executorCmd, timeoutMin: a.executorTimeout },
    review: {
      bigDiff: { files: 15, lines: 400 },
      maxRounds: 2,
      gate: a.gateCmd,
      prefilter: null,
      autoLoop: a.autoLoop,
    },
    memory: a.enableMemory ? undefined : null,
  };

  if (a.enableMemory) {
    const memEntry = ".fapony/.memory/mem.ts";
    config.memory = {
      claim: ["bun", memEntry, "claim", "{id}"],
      close: ["bun", memEntry, "close", "{id}", "{msg}"],
      add: ["bun", memEntry, "add", "{kind}", "{text}"],
      kickoff: ["bun", memEntry, "kickoff"],
    };
  }

  return config;
}

/** Null = path usable; otherwise the error message cmdSetup prints. */
export function validateWorktreePath(worktreePath: string): string | null {
  if (!worktreePath) return "Path must not be empty.";
  if (!existsSync(worktreePath)) return `Path does not exist: ${worktreePath}`;
  return null;
}

/** Overwrite guard — only an affirmative answer proceeds with the write. */
export function shouldOverwriteConfig(answer: string): boolean {
  return isAffirmative(answer);
}

/** Executor timeout in minutes; garbage input falls back to 45. */
export function parseTimeoutMinutes(input: string, fallback = 45): number {
  const n = Number.parseInt(input.trim(), 10);
  return Number.isNaN(n) || n <= 0 ? fallback : n;
}

export async function cmdSetup(): Promise<void> {
  console.log("\n🔧 fapony setup — interactive wizard\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // --- prerequisites ---
    if (!checkCmd("git")) {
      console.error("❌ git is required but not found on PATH.");
      process.exit(1);
    }
    if (!checkCmd("bun")) {
      console.error("❌ bun is required but not found on PATH.");
      console.error("   Install: curl -fsSL https://bun.sh/install | bash");
      process.exit(1);
    }

    // --- worktree path ---
    const gitRoot = detectGitRoot();
    const defaultPath = gitRoot || process.cwd();
    const worktreePath = resolve(await ask(rl, "Worktree path", defaultPath));

    const pathError = validateWorktreePath(worktreePath);
    if (pathError) {
      console.error(`❌ ${pathError}`);
      process.exit(1);
    }

    // --- worktree name ---
    const defaultName = worktreePath.split("/").pop() || "myapp";
    const worktreeName = await ask(
      rl,
      "Worktree name (key for CLI)",
      defaultName,
    );

    // --- executor ---
    console.log();
    const defaultExecutor = "opencode run";
    const executorInput = await ask(rl, "Executor command", defaultExecutor);
    const executorCmd = splitCmd(executorInput);
    const executorTimeout = parseTimeoutMinutes(
      await ask(rl, "Executor timeout (minutes)", "45"),
    );

    // --- gate ---
    console.log();
    const defaultGate = 'claude -p "/code-review high"';
    const gateInput = await ask(rl, "Review gate command", defaultGate);
    const gateCmd = splitCmd(gateInput);

    // --- auto-loop ---
    console.log();
    const autoLoop = isAffirmative(
      await ask(rl, "Enable auto-loop? (y/n)", "n"),
    );

    // --- memory ---
    const enableMemory = isAffirmative(
      await ask(rl, "Enable project memory? (y/n)", "n"),
    );

    // --- detect agents ---
    console.log("\n  Checking installed agents...");
    const hasOpencode = checkCmd("opencode");
    const hasClaude = checkCmd("claude");
    if (!hasOpencode)
      console.log("    ⚠  opencode not found on PATH (needed for executor)");
    if (!hasClaude)
      console.log("    ⚠  claude not found on PATH (needed for review gate)");
    if (hasOpencode && hasClaude)
      console.log("    ✓  opencode + claude detected");

    // --- write config ---
    const config = buildSetupConfig({
      worktreeName,
      worktreePath,
      executorCmd,
      executorTimeout,
      gateCmd,
      autoLoop,
      enableMemory,
    });

    const configPath = join(process.cwd(), "fapony.config.json");
    if (existsSync(configPath)) {
      const overwrite = await ask(
        rl,
        "⚠  fapony.config.json already exists. Overwrite? (y/n)",
        "n",
      );
      if (!shouldOverwriteConfig(overwrite)) {
        console.log("\n  Skipped config write. Existing file kept.");
        rl.close();
        return;
      }
    }

    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`\n  ✓  Wrote ${configPath}`);

    // --- scaffold worktree ---
    const faponyDir = join(worktreePath, ".fapony");
    if (!existsSync(faponyDir)) {
      try {
        initProject(worktreePath);
        console.log(`  ✓  Scaffolded .fapony/ in ${worktreePath}`);
      } catch (e) {
        console.log(`  ⚠  Scaffold skipped: ${(e as Error).message}`);
      }
    } else {
      console.log(`  ✓  .fapony/ already exists in ${worktreePath}`);
    }

    // --- done ---
    console.log(`
  ┌─────────────────────────────────────────┐
  │  Setup complete! Next steps:             │
  │                                         │
  │  1. Write a plan:                       │
  │     cp templates/PLAN.md ${worktreePath}/.fapony/plan/PLAN-my-feature.md  │
  │                                         │
  │  2. Run:                                │
  │     fapony kickoff ${worktreeName}                  │
  │                                         │
  │  3. Check status:                       │
  │     fapony status                       │
  └─────────────────────────────────────────┘
`);
  } finally {
    rl.close();
  }
}
