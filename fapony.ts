#!/usr/bin/env bun

// fapony — multi-agent dev loop orchestrator
// CLI dispatch: all logic lives in src/

import { cmdGate } from "./src/gate.js";
import { cmdHandoff } from "./src/handoff.js";
import { cmdInit } from "./src/init.js";
import { cmdInitMem } from "./src/init-mem.js";
import { cmdKickoff } from "./src/kickoff.js";
import { cmdLoop } from "./src/loop/index.js";
import { cmdMcp } from "./src/mcp.js";
import { cmdPlanMv } from "./src/planmv.js";
import { cmdRun } from "./src/run/index.js";
import { cmdSetup } from "./src/setup.js";
import { installSigintHandler } from "./src/sigint.js";
import { cmdStats } from "./src/stats.js";
import { cmdStatus } from "./src/status.js";
import { cmdStop } from "./src/stop.js";
import { cmdTelemetry } from "./src/telemetry.js";
import { cmdTest } from "./src/test.js";
import { cmdUpdate } from "./src/update.js";

const [cmd, ...a] = process.argv.slice(2);

// Install SIGINT handler for long-running commands (run, loop)
if (cmd === "run" || cmd === "loop") {
  installSigintHandler();
}

if (cmd === "run") {
  await cmdRun(a);
} else if (cmd === "loop") {
  await cmdLoop(a);
} else if (cmd === "status") {
  cmdStatus(a);
} else if (cmd === "stats") {
  cmdStats(a);
} else if (cmd === "telemetry") {
  await cmdTelemetry(a);
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
} else if (cmd === "setup") {
  await cmdSetup();
} else if (cmd === "update") {
  await cmdUpdate();
} else if (cmd === "mcp") {
  cmdMcp();
} else if (cmd === "test") {
  await cmdTest();
} else {
  console.error(`fapony: unknown command "${cmd ?? ""}"`);
  console.error(
    "usage: fapony <setup|update|run|loop|status|stats|telemetry|handoff|stop|gate|init|kickoff|init-mem|mcp|test> [args]",
  );
  process.exit(1);
}
