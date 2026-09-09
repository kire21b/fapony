// test/index.ts — test runner. Import all test modules and run sequentially.

import {
  testConfigDefaults,
  testConfigFileOverrides,
  testConfigUnknownKeysRideAlong,
  testCustomSafetyDeny,
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
import {
  testDbLifecycle,
  testLegacyDbStampedWithoutDataLoss,
  testMigrateDbRejectsNewerSchema,
  testSchemaVersionStamped,
} from "./db.test.js";
import {
  testGateOnceAlreadyPassed,
  testGateOnceFail,
  testGateOnceMaxRounds,
  testGateOncePass,
  testGateOncePassAdequate,
  testGateOncePassExcellent,
  testGateOncePassGood,
  testGateOnceUncertain,
} from "./gate.test.js";
import {
  testInitCreatesDirectories,
  testInitIdempotent,
  testInitNoArgs,
} from "./init.test.js";
import {
  testClaudeAddUsesAbsolutePath,
  testClaudeGetPointsToFapony,
  testCmdInstallDispatchesClaude,
  testCmdInstallRejectsUnknownPlatform,
  testInstallClaudeAbsentAdds,
  testInstallClaudeAddFailureHintsHelp,
  testInstallClaudeAlreadyConfiguredNoOp,
  testInstallClaudeDifferentCommandRefusesOverwrite,
  testInstallClaudeDryRunNeverAdds,
  testInstallClaudeMissingBinary,
  testInstallRootIsRepoRoot,
} from "./install.test.js";
// MCP handcheck tests (split into test/mcp/)
import {
  testExtractMultiFieldEmptyLineEndsField,
  testExtractMultiFieldMultiLine,
  testExtractMultiFieldNone,
  testExtractMultiFieldNotFound,
  testExtractMultiFieldSingle,
  testHandoffCheckAutoGenerate,
  testHandoffCheckAutoGenerateRequiresAgentReport,
  testHandoffCheckAutoGenerateWithUncertainty,
  testHandoffCheckGoodHandoff,
  testHandoffCheckMissingBlock,
  testHandoffCheckMultiLineUncertain,
  testHandoffCheckNotDoneFails,
  testHandoffCheckUncertainFails,
  testHandoffCheckWithFactsCrossRef,
  testHandoffCheckWithoutFacts,
} from "./mcp/check.test.js";
import {
  testHandoffCollectAutoDetectRange,
  testHandoffCollectExplicitRange,
  testHandoffCollectGitError,
  testHandoffCollectMissingArgs,
  testHandoffCollectValidRepo,
} from "./mcp/collect.test.js";
import {
  testCollectEvidenceAgentCommands,
  testCollectEvidenceAgentDuplicatesAllowlist,
  testCollectEvidenceFailingCommand,
  testCollectEvidenceInvalidEntry,
  testCollectEvidenceNoConfig,
  testCollectEvidencePassingCommand,
  testCollectEvidenceRefusesDangerousCommand,
  testCollectEvidenceTimeout,
  testReadEvidenceConfigInvalid,
  testReadEvidenceConfigMissing,
  testReadEvidenceConfigValid,
} from "./mcp/evidence.test.js";
import {
  testEndToEndPipeline,
  testErrorResult,
  testJsonResult,
  testParseToolResult,
  testReasonCodesAreLocked,
} from "./mcp/helpers.test.js";
import {
  testComputeEvidenceSummaryEmpty,
  testComputeEvidenceSummaryMixed,
  testEvidenceStatusesAreLocked,
  testRenderReportTextGitError,
  testRenderReportTextMinimal,
  testRenderReportTextWithCost,
  testRenderReportTextWithFailingEvidence,
  testRenderReportTextWithHandoffChecks,
  testRenderReportTextWithPassedVerdict,
} from "./mcp/primitives.test.js";
import {
  testVerificationReportCheckParity,
  testVerificationReportJsonFormat,
  testVerificationReportMissingArgs,
  testVerificationReportRunNotFound,
  testVerificationReportSurfacesCollectError,
  testVerificationReportTextFormat,
  testVerificationReportToolCount,
  testVerificationReportVerdictFromGateEvent,
} from "./mcp/report.test.js";
import {
  testStatsTextMatchesCli,
  testStatsToolByGradeSeparation,
  testStatsToolEmptyDb,
  testStatsToolJsonMode,
  testStatsToolTextMode,
} from "./mcp/stats.test.js";
import {
  testMcpInitialize,
  testMcpNotificationsIgnored,
  testMcpToolsCallUnknownTool,
  testMcpToolsList,
  testMcpUnknownMethod,
} from "./mcp/transport.test.js";
import {
  testVerdictSubmitAllGrades,
  testVerdictSubmitAutoCreatesRun,
  testVerdictSubmitInvalidReasonCode,
  testVerdictSubmitInvalidVerdict,
  testVerdictSubmitOtherRequiresNote,
  testVerdictSubmitRunNotFound,
  testVerdictSubmitStoresMcpSource,
  testVerdictSubmitSuccess,
} from "./mcp/verdict.test.js";
import {
  testClaimMemoryFailGracefully,
  testClaimMemoryTimeout,
  testMemoryDefaultWiringNoFile,
  testMemoryDefaultWiringWithFile,
  testMemoryExplicitConfigWins,
} from "./memory.test.js";
import {
  testFixtureGuard,
  testParseGateEventData,
  testQualityScore,
} from "./parse.test.js";
import {
  testReportHtmlCanonicalQuality,
  testReportHtmlEscapesContent,
  testReportHtmlFiltersAndMethodology,
  testReportHtmlTotalCostCountsEachSpawnOnce,
} from "./report-html.test.js";
import { testAssertNoPromptInArgv, testAssertSafe } from "./safety.test.js";
import {
  testBuildSetupConfigNoMemory,
  testBuildSetupConfigWithMemory,
  testCmdSetupBunMissing,
  testCmdSetupGitMissing,
  testCmdSetupHappyPathScaffolds,
  testCmdSetupInvalidPath,
  testCmdSetupOverwriteNoKeepsFile,
  testCmdSetupOverwriteYesWritesThrough,
  testCmdSetupScaffoldAlreadyExists,
  testShouldOverwriteConfig,
  testValidateWorktreePath,
  testValidateWorktreePathRejectsFile,
} from "./setup.test.js";
import {
  testStatsByWorktree,
  testStatsEmptyDb,
  testStatsGateWithoutSpawnsInWindow,
  testStatsLegacyPassMergedWithPassAdequate,
  testStatsModelFromExecutorSpawn,
  testStatsMultiRoundSeparateGates,
  testStatsNoPricingValueIsNull,
  testStatsZeroCostValueIsNull,
} from "./stats.test.js";
import {
  testTelemetryAggregatesFromRuns,
  testTelemetryEmptyDb,
  testTelemetryNoContentFields,
  testTelemetryPayloadShape,
  testTelemetryPerRoundCostMultiRound,
  testTelemetrySchemaVersion,
  testTelemetrySelfReportedFromConfig,
  testTelemetrySelfReportedRoundTrip,
  testTelemetrySentAtIso,
  testTelemetryWorktreeRedacted,
} from "./telemetry.test.js";
import {
  testCmdUpdateAlreadyUpToDate,
  testCmdUpdateDirtyDeclined,
  testCmdUpdateDirtyPullOk,
  testCmdUpdateInstallFailureWarns,
  testCmdUpdateLockfileTriggersInstall,
  testCmdUpdateNotARepo,
  testCmdUpdatePullFailPopFail,
  testCmdUpdatePullFailPopOk,
  testFormatDirtyBlock,
  testIsUpToDate,
  testParseDirtyLines,
  testShouldProceedAfterDirty,
  testUpdateReadVersionResolves,
  testUpdateRootIsRepoRoot,
} from "./update.test.js";
import { testIsAffirmative } from "./util.test.js";

export async function cmdTest(): Promise<void> {
  console.log("running tests...\n");
  testAssertSafe();
  testAssertNoPromptInArgv();
  testDbLifecycle();
  testSchemaVersionStamped();
  testLegacyDbStampedWithoutDataLoss();
  testMigrateDbRejectsNewerSchema();
  testParseGateEventData();
  testFixtureGuard();
  testQualityScore();
  testGateOncePass();
  testGateOnceFail();
  testGateOnceAlreadyPassed();
  testGateOnceMaxRounds();
  testGateOncePassExcellent();
  testGateOncePassGood();
  testGateOncePassAdequate();
  testGateOnceUncertain();
  testInitCreatesDirectories();
  testInitIdempotent();
  testInitNoArgs();
  testMemoryDefaultWiringWithFile();
  testMemoryDefaultWiringNoFile();
  testMemoryExplicitConfigWins();
  testClaimMemoryFailGracefully();
  // ponytail: real ~15s execSync timeout regression test — skip in the fast
  // dev loop, keep it for CI/pre-commit (bun fapony.ts test, no SKIP_SLOW).
  if (!process.env.SKIP_SLOW) testClaimMemoryTimeout();
  else console.log("  ⏭ claimMemory timeout prevents hang (SKIP_SLOW)");
  testConfigDefaults();
  testConfigFileOverrides();
  testConfigUnknownKeysRideAlong();
  testCustomSafetyDeny();
  testTemplateArgsReplaceAll();
  testCostAttributionAndBytes();
  testCostUsdEstimate();
  testCostPricingNullKeepsBytes();
  testCostBeginEndRoundTrip();
  testCostHandoffAndFormat();
  testCostTelemetryAllowlist();
  testBuildSetupConfigNoMemory();
  testBuildSetupConfigWithMemory();
  testValidateWorktreePath();
  testValidateWorktreePathRejectsFile();
  testShouldOverwriteConfig();
  await testCmdSetupGitMissing();
  await testCmdSetupBunMissing();
  await testCmdSetupInvalidPath();
  await testCmdSetupOverwriteNoKeepsFile();
  await testCmdSetupOverwriteYesWritesThrough();
  await testCmdSetupHappyPathScaffolds();
  await testCmdSetupScaffoldAlreadyExists();
  testIsAffirmative();
  testParseDirtyLines();
  testFormatDirtyBlock();
  testShouldProceedAfterDirty();
  testIsUpToDate();
  testUpdateRootIsRepoRoot();
  testUpdateReadVersionResolves();
  await testCmdUpdateNotARepo();
  await testCmdUpdateDirtyDeclined();
  await testCmdUpdateDirtyPullOk();
  await testCmdUpdatePullFailPopOk();
  await testCmdUpdatePullFailPopFail();
  await testCmdUpdateAlreadyUpToDate();
  await testCmdUpdateLockfileTriggersInstall();
  await testCmdUpdateInstallFailureWarns();
  testInstallRootIsRepoRoot();
  testClaudeAddUsesAbsolutePath();
  testClaudeGetPointsToFapony();
  testInstallClaudeAbsentAdds();
  testInstallClaudeAlreadyConfiguredNoOp();
  testInstallClaudeDifferentCommandRefusesOverwrite();
  testInstallClaudeDryRunNeverAdds();
  testInstallClaudeMissingBinary();
  testInstallClaudeAddFailureHintsHelp();
  testCmdInstallDispatchesClaude();
  testCmdInstallRejectsUnknownPlatform();
  // MCP handcheck tests
  testMcpInitialize();
  testMcpToolsList();
  testMcpNotificationsIgnored();
  testMcpUnknownMethod();
  testMcpToolsCallUnknownTool();
  testStatsToolEmptyDb();
  testStatsToolJsonMode();
  testStatsToolTextMode();
  testStatsTextMatchesCli();
  testStatsToolByGradeSeparation();
  testHandoffCollectMissingArgs();
  testHandoffCollectAutoDetectRange();
  testHandoffCollectExplicitRange();
  testHandoffCollectValidRepo();
  testHandoffCollectGitError();
  testHandoffCheckMissingBlock();
  testHandoffCheckGoodHandoff();
  testHandoffCheckUncertainFails();
  testHandoffCheckNotDoneFails();
  testHandoffCheckAutoGenerate();
  testHandoffCheckAutoGenerateRequiresAgentReport();
  testHandoffCheckAutoGenerateWithUncertainty();
  testHandoffCheckWithFactsCrossRef();
  testHandoffCheckWithoutFacts();
  testHandoffCheckMultiLineUncertain();
  testVerdictSubmitInvalidVerdict();
  testVerdictSubmitInvalidReasonCode();
  testVerdictSubmitOtherRequiresNote();
  testVerdictSubmitRunNotFound();
  testVerdictSubmitSuccess();
  testVerdictSubmitStoresMcpSource();
  testVerdictSubmitAutoCreatesRun();
  testVerdictSubmitAllGrades();
  testEndToEndPipeline();
  testExtractMultiFieldNone();
  testExtractMultiFieldSingle();
  testExtractMultiFieldMultiLine();
  testExtractMultiFieldEmptyLineEndsField();
  testExtractMultiFieldNotFound();
  testJsonResult();
  testErrorResult();
  testParseToolResult();
  testReasonCodesAreLocked();
  // Verification primitives tests
  testEvidenceStatusesAreLocked();
  testComputeEvidenceSummaryEmpty();
  testComputeEvidenceSummaryMixed();
  testRenderReportTextMinimal();
  testRenderReportTextWithPassedVerdict();
  testRenderReportTextWithFailingEvidence();
  testRenderReportTextWithHandoffChecks();
  testRenderReportTextWithCost();
  testRenderReportTextGitError();
  // Evidence collector tests
  testReadEvidenceConfigMissing();
  testReadEvidenceConfigInvalid();
  testReadEvidenceConfigValid();
  testCollectEvidenceNoConfig();
  testCollectEvidencePassingCommand();
  testCollectEvidenceFailingCommand();
  testCollectEvidenceAgentCommands();
  testCollectEvidenceAgentDuplicatesAllowlist();
  testCollectEvidenceTimeout();
  testCollectEvidenceRefusesDangerousCommand();
  testCollectEvidenceInvalidEntry();
  // Verification report tool tests
  testVerificationReportMissingArgs();
  testVerificationReportRunNotFound();
  testVerificationReportTextFormat();
  testVerificationReportJsonFormat();
  testVerificationReportToolCount();
  testVerificationReportVerdictFromGateEvent();
  testVerificationReportCheckParity();
  testVerificationReportSurfacesCollectError();
  // Stats enrichment tests
  testStatsEmptyDb();
  testStatsNoPricingValueIsNull();
  testStatsZeroCostValueIsNull();
  testStatsMultiRoundSeparateGates();
  testStatsGateWithoutSpawnsInWindow();
  testStatsLegacyPassMergedWithPassAdequate();
  testStatsByWorktree();
  testStatsModelFromExecutorSpawn();
  // Telemetry tests
  testTelemetrySchemaVersion();
  testTelemetryPayloadShape();
  testTelemetryNoContentFields();
  testTelemetryEmptyDb();
  testTelemetryAggregatesFromRuns();
  testTelemetryWorktreeRedacted();
  testTelemetrySelfReportedFromConfig();
  testTelemetrySentAtIso();
  testTelemetryPerRoundCostMultiRound();
  testTelemetrySelfReportedRoundTrip();
  testReportHtmlTotalCostCountsEachSpawnOnce();
  testReportHtmlCanonicalQuality();
  testReportHtmlFiltersAndMethodology();
  testReportHtmlEscapesContent();
  console.log("\nall tests passed ✓");
}
