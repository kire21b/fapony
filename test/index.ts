// test/index.ts — test runner. Import all test modules and run sequentially.
import { testAssertSafe } from "./safety.test.js";
import { testParseHandoff, testRenderHandoff } from "./handoff.test.js";
import { testDbLifecycle, testGetLastPlanUpdate } from "./db.test.js";
import {
  testParseGateVerdict,
  testParsePlanUpdate,
  testFixtureGuard,
} from "./parse.test.js";
import {
  testGateOncePass,
  testGateOnceFail,
  testGateOnceAlreadyPassed,
  testGateOnceMaxRounds,
} from "./gate.test.js";

export async function cmdTest(): Promise<void> {
  console.log("running tests...\n");
  testAssertSafe();
  testParseHandoff();
  testDbLifecycle();
  testRenderHandoff();
  testParseGateVerdict();
  testParsePlanUpdate();
  testFixtureGuard();
  testGetLastPlanUpdate();
  testGateOncePass();
  testGateOnceFail();
  testGateOnceAlreadyPassed();
  testGateOnceMaxRounds();
  console.log("\nall tests passed ✓");
}
