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
import {
  testPlanMvNoHeader,
  testPlanMvWithHeader,
  testPlanMvNormalizeLinks,
  testPlanMvDryRun,
  testPlanMvAlreadyDatedNotDoublePrefixed,
} from "./planmv.test.js";
import {
  testInitCreatesDirectories,
  testInitIdempotent,
  testInitNoArgs,
} from "./init.test.js";
import {
  testKickoffSinglePending,
  testKickoffShippedFiltered,
  testKickoffMultiplePending,
  testKickoffNoPending,
} from "./kickoff.test.js";
import {
  testMemoryDefaultWiringWithFile,
  testMemoryDefaultWiringNoFile,
  testMemoryExplicitConfigWins,
} from "./memory.test.js";
import {
  testShouldScrutinizeFix,
  testBuildScrutinizePrompt,
  testResolveChangedFiles,
  testSpawnScrutinizeFix,
  testSpawnScrutinizeFixRejectsDangerousCmd,
} from "./scrutinize.test.js";
import {
  testAutoArchivePlanSynthesizesHeader,
  testAutoArchivePlanKeepsExistingHeader,
  testAutoArchivePlanNormalizesLinks,
  testAutoArchivePlanMissingFile,
} from "./archive.test.js";
import {
  testConfigDefaults,
  testConfigFileOverrides,
  testCustomMarkersParse,
  testCustomSafetyDeny,
  testTemplateArgsReplaceAll,
  testRenderRolePrompt,
  testSourceAndShippedRE,
} from "./config.test.js";
import {
  testBuildExecutorPrompt,
  testExecutorCmdRolePreference,
} from "./run.test.js";
import {
  testPlanHygieneOk,
  testPlanHygieneTooLong,
  testPlanHygieneSpecLeak,
  testPlanHygieneNoSpecNoLeakWarning,
} from "./planlint.test.js";
import {
  testStatusTableShowsNothingWhenEmpty,
  testStatusTableShowsPlanAndMemId,
} from "./status.test.js";

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
  testPlanMvNoHeader();
  testPlanMvWithHeader();
  testPlanMvNormalizeLinks();
  testPlanMvDryRun();
  testPlanMvAlreadyDatedNotDoublePrefixed();
  testInitCreatesDirectories();
  testInitIdempotent();
  testInitNoArgs();
  testKickoffSinglePending();
  testKickoffShippedFiltered();
  testKickoffMultiplePending();
  testKickoffNoPending();
  testMemoryDefaultWiringWithFile();
  testMemoryDefaultWiringNoFile();
  testMemoryExplicitConfigWins();
  testShouldScrutinizeFix();
  testBuildScrutinizePrompt();
  testResolveChangedFiles();
  await testSpawnScrutinizeFix();
  await testSpawnScrutinizeFixRejectsDangerousCmd();
  testAutoArchivePlanSynthesizesHeader();
  testAutoArchivePlanKeepsExistingHeader();
  testAutoArchivePlanNormalizesLinks();
  testAutoArchivePlanMissingFile();
  testConfigDefaults();
  testConfigFileOverrides();
  testCustomMarkersParse();
  testCustomSafetyDeny();
  testTemplateArgsReplaceAll();
  testRenderRolePrompt();
  testSourceAndShippedRE();
  testBuildExecutorPrompt();
  testExecutorCmdRolePreference();
  testPlanHygieneOk();
  testPlanHygieneTooLong();
  testPlanHygieneSpecLeak();
  testPlanHygieneNoSpecNoLeakWarning();
  testStatusTableShowsNothingWhenEmpty();
  testStatusTableShowsPlanAndMemId();
  console.log("\nall tests passed ✓");
}
