import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, loadConfig } from "../src/db/index.js";
import { buildExecutorPrompt, executorCmd, runOnce } from "../src/run/index.js";
import { createTestRepo } from "./fixtures/repo.js";

export function testBuildExecutorPrompt(): void {
  const template =
    "PLAN={{PLAN}}\nMEM={{MEM_ID}}\nSPEC={{SPEC}}\nFB={{FEEDBACK}}";

  // all sections present
  const full = buildExecutorPrompt(
    template,
    "build it",
    "m-1",
    "spec body",
    "fix X",
  );
  assert.equal(full, "PLAN=build it\nMEM=m-1\nSPEC=spec body\nFB=fix X");

  // absent sections → sentinels
  const empty = buildExecutorPrompt(template, "build it", null, null, null);
  assert.equal(
    empty,
    "PLAN=build it\nMEM=none\nSPEC=(no spec)\nFB=(none — first round)",
  );

  // $ sequences in plan/feedback must survive literally
  const tricky = buildExecutorPrompt(
    template,
    "costs $100",
    "m",
    null,
    "note $& $' here",
  );
  assert(tricky.includes("PLAN=costs $100"), "$ in plan must be literal");
  assert(
    tricky.includes("FB=note $& $' here"),
    "$ in feedback must be literal",
  );
  assert(!tricky.includes("PLAN={{PLAN}}"), "no template residue");

  console.log("  ✓ buildExecutorPrompt sections + $-literal safety");
}

export function testExecutorCmdRolePreference(): void {
  const base = loadConfig("/nonexistent-path/fapony.config.json");

  // no roles.executor → plain executor.cmd, {model} absent → no residue
  assert.deepEqual(executorCmd(base, "m-1"), ["opencode", "run"]);

  // roles.executor wins and gets {model}/{id} filled
  const withRole: Config = {
    ...base,
    executor: { cmd: ["opencode", "run"], timeoutMin: 45 },
    roles: {
      executor: {
        cmd: ["opencode", "run", "--model", "{model}"],
        model: "mimo",
      },
    },
  };
  assert.deepEqual(executorCmd(withRole, "m-1"), [
    "opencode",
    "run",
    "--model",
    "mimo",
  ]);

  // no model set → {model} becomes "" (caller's template choice)
  const noModel: Config = {
    ...base,
    roles: { executor: { cmd: ["opencode", "run", "--model", "{model}"] } },
  };
  assert.deepEqual(executorCmd(noModel, null), [
    "opencode",
    "run",
    "--model",
    "",
  ]);

  console.log("  ✓ executorCmd roles.executor preference + model fill");
}

export async function testRunOnceAbortedMarksStopped(): Promise<void> {
  // isAborted()=true aborts before attempt 1, so the executor never spawns
  // and withRetry returns !exhausted — runOnce must record stopped, not
  // stalled (user aborts must not pollute stall-rate stats).
  const repo = createTestRepo();
  const stateDir = mkdtempSync(join(tmpdir(), "fapony-run-state-"));
  const configPath = join(stateDir, "fapony.config.json");
  writeFileSync(configPath, JSON.stringify({ worktrees: { t: repo.dir } }));
  const savedConfig = process.env.FAPONY_CONFIG;
  const savedState = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_CONFIG = configPath;
  process.env.FAPONY_STATE_DIR = stateDir;
  const origErr = console.error;
  console.error = () => {};
  try {
    const result = await runOnce({
      worktreeKey: "t",
      planPath: null,
      planContent: "# test plan\n",
      memId: null,
      allowDirty: true,
      isAborted: async () => true,
    });
    assert.equal(
      result.status,
      "stopped",
      `aborted run must be stopped, got ${result.status}`,
    );
    assert.ok(result.runId > 0, "run row must exist");
  } finally {
    console.error = origErr;
    if (savedConfig === undefined) delete process.env.FAPONY_CONFIG;
    else process.env.FAPONY_CONFIG = savedConfig;
    if (savedState === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = savedState;
    repo.cleanup();
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log("  ✓ runOnce aborted marks stopped (not stalled)");
}
