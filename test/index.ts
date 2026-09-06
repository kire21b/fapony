// test/index.ts — test runner. Import all test modules and run sequentially.

import {
  testAutoArchivePlanKeepsExistingHeader,
  testAutoArchivePlanMissingFile,
  testAutoArchivePlanNormalizesLinks,
  testAutoArchivePlanSynthesizesHeader,
} from "./archive.test.js";
import {
  testConfigDefaults,
  testConfigFileOverrides,
  testCustomMarkersParse,
  testCustomSafetyDeny,
  testRenderRolePrompt,
  testSourceAndShippedRE,
  testTemplateArgsReplaceAll,
} from "./config.test.js";
import {
  testCostAttributionAndBytes,
  testCostBeginEndRoundTrip,
  testCostHandoffAndFormat,
  testCostPricingNullKeepsBytes,
  testCostTelemetryAllowlist,
  testCostUsdEstimate,
} from "./cost.test.js";
import { testDbLifecycle, testGetLastPlanUpdate } from "./db.test.js";
import {
  testGateOnceAlreadyPassed,
  testGateOnceFail,
  testGateOnceMaxRounds,
  testGateOncePass,
} from "./gate.test.js";
import { testParseHandoff, testRenderHandoff } from "./handoff.test.js";
import {
  testInitCreatesDirectories,
  testInitIdempotent,
  testInitNoArgs,
} from "./init.test.js";
import {
  testKickoffMultiplePending,
  testKickoffNoPending,
  testKickoffShippedFiltered,
  testKickoffSinglePending,
} from "./kickoff.test.js";
import {
  testMemoryDefaultWiringNoFile,
  testMemoryDefaultWiringWithFile,
  testMemoryExplicitConfigWins,
} from "./memory.test.js";
import {
  testFixtureGuard,
  testParseGateVerdict,
  testParsePlanUpdate,
} from "./parse.test.js";
import {
  testPlanHygieneNoSpecNoLeakWarning,
  testPlanHygieneOk,
  testPlanHygieneSpecLeak,
  testPlanHygieneTooLong,
} from "./planlint.test.js";
import {
  testPlanMvAlreadyDatedNotDoublePrefixed,
  testPlanMvDryRun,
  testPlanMvNoHeader,
  testPlanMvNormalizeLinks,
  testPlanMvWithHeader,
} from "./planmv.test.js";
import {
  testBuildExecutorPrompt,
  testExecutorCmdRolePreference,
} from "./run.test.js";
import { testAssertSafe } from "./safety.test.js";
import {
  testBuildScrutinizePrompt,
  testResolveChangedFiles,
  testShouldScrutinizeFix,
  testSpawnScrutinizeFix,
  testSpawnScrutinizeFixRejectsDangerousCmd,
} from "./scrutinize.test.js";
import {
  testSplitCmdEmptyQuotedString,
  testSplitCmdEmptyString,
  testSplitCmdMultipleQuotedArgs,
  testSplitCmdNoQuotes,
  testSplitCmdQuotedArg,
  testSplitCmdSimpleArgs,
} from "./setup.test.js";
import {
  testStatusTableShowsNothingWhenEmpty,
  testStatusTableShowsPlanAndMemId,
  testStatusTableTruncatesLongMemId,
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
  testStatusTableTruncatesLongMemId();
  testCostAttributionAndBytes();
  testCostUsdEstimate();
  testCostPricingNullKeepsBytes();
  testCostBeginEndRoundTrip();
  testCostHandoffAndFormat();
  testCostTelemetryAllowlist();
  testSplitCmdSimpleArgs();
  testSplitCmdQuotedArg();
  testSplitCmdMultipleQuotedArgs();
  testSplitCmdEmptyString();
  testSplitCmdNoQuotes();
  testSplitCmdEmptyQuotedString();
  console.log("\nall tests passed ✓");
}
