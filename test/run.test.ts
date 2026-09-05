import assert from "node:assert";
import { buildExecutorPrompt, executorCmd } from "../src/run.js";
import { loadConfig, type Config } from "../src/db.js";

export function testBuildExecutorPrompt(): void {
  const template = "PLAN={{PLAN}}\nMEM={{MEM_ID}}\nSPEC={{SPEC}}\nFB={{FEEDBACK}}";

  // all sections present
  const full = buildExecutorPrompt(template, "build it", "m-1", "spec body", "fix X");
  assert.equal(full, "PLAN=build it\nMEM=m-1\nSPEC=spec body\nFB=fix X");

  // absent sections → sentinels
  const empty = buildExecutorPrompt(template, "build it", null, null, null);
  assert.equal(empty, "PLAN=build it\nMEM=none\nSPEC=(no spec)\nFB=(none — first round)");

  // $ sequences in plan/feedback must survive literally
  const tricky = buildExecutorPrompt(template, "costs $100", "m", null, "note $& $' here");
  assert(tricky.includes("PLAN=costs $100"), "$ in plan must be literal");
  assert(tricky.includes("FB=note $& $' here"), "$ in feedback must be literal");
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
    roles: { executor: { cmd: ["opencode", "run", "--model", "{model}"], model: "mimo" } },
  };
  assert.deepEqual(executorCmd(withRole, "m-1"), ["opencode", "run", "--model", "mimo"]);

  // no model set → {model} becomes "" (caller's template choice)
  const noModel: Config = {
    ...base,
    roles: { executor: { cmd: ["opencode", "run", "--model", "{model}"] } },
  };
  assert.deepEqual(executorCmd(noModel, null), ["opencode", "run", "--model", ""]);

  console.log("  ✓ executorCmd roles.executor preference + model fill");
}
