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

function defaultDetectGitRoot(): string | null {
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

function defaultCheckCmd(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** Minimal seam for cmdSetup — only the I/O cmdSetup calls directly (the
 *  prerequisites check, git-root detection, prompting, and exit). fs/cwd stay
 *  real: tests run against a temp dir. Every field is used by both the
 *  default (production) path and the test path. */
export interface SetupDeps {
  checkCmd?: (cmd: string) => boolean;
  detectGitRoot?: () => string | null;
  ask?: (question: string, defaultVal?: string) => Promise<string>;
  exit?: (code: number) => never;
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

export async function cmdSetup(deps: SetupDeps = {}): Promise<void> {
  console.log("\n🔧 fapony setup — interactive wizard\n");

  const checkCmdFn = deps.checkCmd ?? defaultCheckCmd;
  const detectGitRootFn = deps.detectGitRoot ?? defaultDetectGitRoot;
  const exitFn = deps.exit ?? ((code: number): never => process.exit(code));
  // Real readline only exists on the default path — injected ask (tests)
  // never touches stdin.
  const rl = deps.ask
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  const askFn =
    deps.ask ??
    ((question: string, defaultVal?: string) => ask(rl!, question, defaultVal));

  try {
    // --- prerequisites ---
    if (!checkCmdFn("git")) {
      console.error("❌ git is required but not found on PATH.");
      exitFn(1);
    }
    if (!checkCmdFn("bun")) {
      console.error("❌ bun is required but not found on PATH.");
      console.error("   Install: curl -fsSL https://bun.sh/install | bash");
      exitFn(1);
    }

    // --- worktree path ---
    const gitRoot = detectGitRootFn();
    const defaultPath = gitRoot || process.cwd();
    const worktreePath = resolve(await askFn("Worktree path", defaultPath));

    const pathError = validateWorktreePath(worktreePath);
    if (pathError) {
      console.error(`❌ ${pathError}`);
      exitFn(1);
    }

    // --- worktree name ---
    const defaultName = worktreePath.split("/").pop() || "myapp";
    const worktreeName = await askFn(
      "Worktree name (key for CLI)",
      defaultName,
    );

    // --- executor ---
    console.log();
    const defaultExecutor = "opencode run";
    const executorInput = await askFn("Executor command", defaultExecutor);
    const executorCmd = splitCmd(executorInput);
    const executorTimeout = parseTimeoutMinutes(
      await askFn("Executor timeout (minutes)", "45"),
    );

    // --- gate ---
    console.log();
    const defaultGate = 'claude -p "/code-review high"';
    const gateInput = await askFn("Review gate command", defaultGate);
    const gateCmd = splitCmd(gateInput);

    // --- auto-loop ---
    console.log();
    const autoLoop = isAffirmative(await askFn("Enable auto-loop? (y/n)", "n"));

    // --- memory ---
    const enableMemory = isAffirmative(
      await askFn("Enable project memory? (y/n)", "n"),
    );

    // --- detect agents ---
    console.log("\n  Checking installed agents...");
    const hasOpencode = checkCmdFn("opencode");
    const hasClaude = checkCmdFn("claude");
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
      const overwrite = await askFn(
        "⚠  fapony.config.json already exists. Overwrite? (y/n)",
        "n",
      );
      if (!shouldOverwriteConfig(overwrite)) {
        console.log("\n  Skipped config write. Existing file kept.");
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
    rl?.close();
  }
}
