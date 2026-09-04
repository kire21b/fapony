#!/usr/bin/env bun
// fapony — multi-agent dev loop orchestrator
// CLI dispatch: all logic lives in src/

import { cmdRun } from "./src/run.js";
import { cmdStatus } from "./src/status.js";
import { cmdHandoff } from "./src/handoff.js";
import { cmdStop } from "./src/stop.js";
import { cmdTest } from "./src/test.js";
import { cmdGate } from "./src/gate.js";

const [cmd, ...a] = process.argv.slice(2);

if (cmd === "run") {
  await cmdRun(a);
} else if (cmd === "status") {
  cmdStatus(a);
} else if (cmd === "handoff") {
  cmdHandoff(a);
} else if (cmd === "stop") {
  await cmdStop(a);
} else if (cmd === "gate") {
  await cmdGate(a);
} else if (cmd === "test") {
  await cmdTest();
} else {
  console.error(`fapony: unknown command "${cmd ?? ""}"`);
  console.error("usage: fapony <run|status|handoff|stop|gate|test> [args]");
  process.exit(1);
}
