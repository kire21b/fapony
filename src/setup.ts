// src/setup.ts — interactive wizard: config + scaffold in one step.
// Replaces the manual cp + edit + init flow.

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { initProject } from "./init.js";

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
    execSync(`command -v ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
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

    if (!existsSync(worktreePath)) {
      console.error(`❌ Path does not exist: ${worktreePath}`);
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
    const executorTimeout = Number.parseInt(
      await ask(rl, "Executor timeout (minutes)", "45"),
      10,
    );

    // --- gate ---
    console.log();
    const defaultGate = 'claude -p "/code-review high"';
    const gateInput = await ask(rl, "Review gate command", defaultGate);
    const gateCmd = splitCmd(gateInput);

    // --- auto-loop ---
    console.log();
    const autoLoopAns = (
      await ask(rl, "Enable auto-loop? (y/n)", "n")
    ).toLowerCase();
    const autoLoop = autoLoopAns === "y" || autoLoopAns === "yes";

    // --- memory ---
    const memAns = (
      await ask(rl, "Enable project memory? (y/n)", "n")
    ).toLowerCase();
    const enableMemory = memAns === "y" || memAns === "yes";

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
    const config: Record<string, unknown> = {
      worktrees: { [worktreeName]: worktreePath },
      executor: { cmd: executorCmd, timeoutMin: executorTimeout },
      review: {
        bigDiff: { files: 15, lines: 400 },
        maxRounds: 2,
        gate: gateCmd,
        prefilter: null,
        autoLoop,
      },
      memory: enableMemory ? undefined : null,
    };

    if (enableMemory) {
      const memEntry = ".fapony/.memory/mem.ts";
      config.memory = {
        claim: ["bun", memEntry, "claim", "{id}"],
        close: ["bun", memEntry, "close", "{id}", "{msg}"],
        add: ["bun", memEntry, "add", "{kind}", "{text}"],
        kickoff: ["bun", memEntry, "kickoff"],
      };
    }

    const configPath = join(process.cwd(), "fapony.config.json");
    if (existsSync(configPath)) {
      const overwrite = (
        await ask(
          rl,
          "⚠  fapony.config.json already exists. Overwrite? (y/n)",
          "n",
        )
      ).toLowerCase();
      if (overwrite !== "y" && overwrite !== "yes") {
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
