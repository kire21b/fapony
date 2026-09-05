#!/usr/bin/env bun
// fapony — multi-agent dev loop orchestrator
// CLI dispatch: all logic lives in src/

import { cmdRun } from "./src/run.js";
import { cmdStatus } from "./src/status.js";
import { cmdHandoff } from "./src/handoff.js";
import { cmdStop } from "./src/stop.js";
import { cmdTest } from "./src/test.js";
import { cmdGate } from "./src/gate.js";
import { cmdInitMem } from "./src/init-mem.js";
import { cmdLoop } from "./src/loop.js";
import { cmdPlanMv } from "./src/planmv.js";
import { cmdInit } from "./src/init.js";
import { cmdKickoff } from "./src/kickoff.js";

const [cmd, ...a] = process.argv.slice(2);

if (cmd === "run") {
  await cmdRun(a);
} else if (cmd === "loop") {
  await cmdLoop(a);
} else if (cmd === "status") {
  cmdStatus(a);
} else if (cmd === "handoff") {
  cmdHandoff(a);
} else if (cmd === "stop") {
  await cmdStop(a);
} else if (cmd === "gate") {
  await cmdGate(a);
} else if (cmd === "init-mem") {
  cmdInitMem(a);
} else if (cmd === "init") {
  cmdInit(a);
} else if (cmd === "kickoff") {
  await cmdKickoff(a);
} else if (cmd === "plan-mv") {
  await cmdPlanMv(a);
} else if (cmd === "test") {
  await cmdTest();
} else {
  console.error(`fapony: unknown command "${cmd ?? ""}"`);
  console.error("usage: fapony <run|loop|status|handoff|stop|gate|init|kickoff|init-mem|test> [args]");
  process.exit(1);
}
