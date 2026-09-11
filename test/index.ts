// test/index.ts — test runner. Import all test modules and run sequentially.

import {
  testClaudeProjectSlug,
  testFindSessionAt,
} from "./activeSession.test.js";
import {
  testAnalyzeBlastRadius,
  testAnalyzeChangedUntested,
  testAnalyzeEmptyDir,
  testAnalyzeHubOrphanCycle,
  testAnalyzeIsTestFile,
  testAnalyzeSkipsUnresolvableAndBroken,
} from "./analyze.test.js";
import {
  testConfigDefaults,
  testConfigFileOverrides,
  testConfigUnknownKeysRideAlong,
  testCustomSafetyDeny,
  testTemplateArgsReplaceAll,
} from "./config.test.js";
import {
  testContextBlockFilesFilterBeyondTop3,
  testContextBlockLineCap,
  testContextBlockLowHistory,
  testContextBlockLowHistoryStillShowsNotes,
  testContextBlockNoPatterns,
  testContextBlockRecentNotes,
  testContextBlockSnapshot,
  testContextBlockWorktreeScope,
  testContextToolEmptyDb,
  testContextToolEndToEnd,
} from "./context.test.js";
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
  testFindSessionModelClaudeCodeHit,
  testFindSessionModelClaudeCodeMajority,
  testFindSessionModelClaudeCodeMiss,
  testFindSessionModelClaudeCodeTieGoesLast,
  testFindSessionModelCodexHit,
  testFindSessionModelCodexMiss,
  testFindSessionModelCodexMultiMeta,
  testFindSessionModelCodexMultiMetaTieGoesLast,
  testFindSessionModelEmptyId,
  testFindSessionModelNoReadersAvailable,
  testFindSessionModelOpenCodeHit,
  testFindSessionModelOpenCodeMiss,
  testFindSessionModelOpenCodePlainTextProviderUnknown,
  testFindSessionModelZcodeHit,
  testFindSessionModelZcodeMiss,
  testFindSessionModelZcodeMultiModel,
  testFindSessionModelZcodeRawProviderPassthrough,
  testFindSessionModelZcodeSummedTokensWin,
} from "./findModel.test.js";
import {
  testGateOnceAlreadyPassed,
  testGateOnceAlreadyStalled,
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
  testCmdInstallDispatchesCodex,
  testCmdInstallDispatchesOpencode,
  testCmdInstallDispatchesZcode,
  testCmdInstallRejectsUnknownPlatform,
  testInstallClaudeAbsentAdds,
  testInstallClaudeAddFailureHintsHelp,
  testInstallClaudeAlreadyConfiguredNoOp,
  testInstallClaudeDifferentCommandRefusesOverwrite,
  testInstallClaudeDryRunNeverAdds,
  testInstallClaudeForeignScriptRefusesOverwrite,
  testInstallClaudeForeignStatuslineRefusesOverwrite,
  testInstallClaudeMissingBinary,
  testInstallClaudeStatuslineWiresSettings,
  testInstallCodexAlreadyConfiguredNoOp,
  testInstallCodexAppendsEntry,
  testInstallCodexDryRunNoWrite,
  testInstallCodexNoConfigFails,
  testInstallOpencodeAlreadyConfiguredNoOp,
  testInstallOpencodeDryRunNoWrite,
  testInstallOpencodeNewFile,
  testInstallOpencodeParseErrorFails,
  testInstallRootIsRepoRoot,
  testInstallZcodeAlreadyConfiguredNoOp,
  testInstallZcodeDryRunNoWrite,
  testInstallZcodeFallbackPath,
  testInstallZcodeNoConfigFails,
  testInstallZcodePrimaryPath,
  testLinkSkillsCreatesSymlinks,
  testLinkSkillsDryRunNoWrite,
  testLinkSkillsIdempotent,
  testLinkSkillsRefusesOverwrite,
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
  testHandoffCheckBlastRadiusWithWorktree,
  testHandoffCheckGoodHandoff,
  testHandoffCheckMissingBlock,
  testHandoffCheckMultiLineUncertain,
  testHandoffCheckNoBlastRadiusWithoutWorktree,
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
  testHandoffCollectReturnsFiles,
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
  testReadEvidenceConfigCustomPath,
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
  testPlanListJoinsRunHistory,
  testPlanListMissingDir,
  testPlanListNeverAttempted,
  testPlanListRequiresWorktree,
  testPlanListUsesWorktreeConfigPaths,
} from "./mcp/plans.test.js";
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
  testVerificationReportWorktreeOnlyCreatesNoRun,
} from "./mcp/report.test.js";
import {
  testStatsEfficiencyTextFailCensored,
  testStatsTextMatchesCli,
  testStatsToolByGradeSeparation,
  testStatsToolEmptyDb,
  testStatsToolGroupByInvalid,
  testStatsToolGroupByPlan,
  testStatsToolGroupByPlanWorktreeScoped,
  testStatsToolGroupByReasonCode,
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
  testUsageDefaultRegression,
  testUsageDetailJson,
  testUsageDetailText,
} from "./mcp/usage.test.js";
import {
  testVerdictSubmitAllGrades,
  testVerdictSubmitAutoCreatesRun,
  testVerdictSubmitInvalidReasonCode,
  testVerdictSubmitInvalidVerdict,
  testVerdictSubmitNullPlanAlwaysCreatesNew,
  testVerdictSubmitOtherRequiresNote,
  testVerdictSubmitPassedRunNotReused,
  testVerdictSubmitReusesOpenRunAcrossRounds,
  testVerdictSubmitRunNotFound,
  testVerdictSubmitStoresMcpSource,
  testVerdictSubmitSuccess,
} from "./mcp/verdict.test.js";
import {
  testResolveWorktreeArgAbsolutePath,
  testResolveWorktreeArgKeyLookup,
  testResolveWorktreeArgKeyNotFound,
  testResolveWorktreeArgSentinel,
} from "./mcp/worktree.test.js";
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
  testReportHtmlByModelHasAttributionColumns,
  testReportHtmlCanonicalQuality,
  testReportHtmlEscapesContent,
  testReportHtmlFiltersAndMethodology,
  testReportHtmlTotalCostCountsEachSpawnOnce,
} from "./report-html.test.js";
import { testAssertSafe } from "./safety.test.js";
import {
  testMergeBytesByToolSumsAcrossClients,
  testReadClaudeCodeUsageFilterByWorktree,
  testReadClaudeCodeUsageNoDir,
  testReadClaudeCodeUsagePrimaryPath,
  testReadClaudeCodeUsageSkipsMalformedLines,
  testReadCodexUsageFilterByWorktree,
  testReadCodexUsageNoDir,
  testReadCodexUsagePrimaryPath,
  testReadCodexUsageSkipsMalformedLines,
  testReadZcodeUsageDetail,
  testReadZcodeUsageFilterByWorktree,
  testReadZcodeUsageNoDb,
  testReadZcodeUsagePrimaryPath,
  testSessionDefaultHasNoDetail,
  testSessionDetailBreakdown,
  testSessionDetailMatchesRawSql,
  testSessionDetailSkipsUnknownType,
  testSessionDetailStepTokensNotSummed,
} from "./session.test.js";
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
  testCountPendingPlans,
  testStatsBestPassing,
  testStatsByFileRisk,
  testStatsByModelGroupsByClientProviderAgent,
  testStatsByWorktree,
  testStatsEfficiencyBytesProxy,
  testStatsEfficiencyFailIsInfinite,
  testStatsEfficiencyJsonFailCensored,
  testStatsEfficiencyNoGateIsNull,
  testStatsEfficiencyUsd,
  testStatsEmptyDb,
  testStatsEscalatedRuns,
  testStatsGateWithoutSpawnsInWindow,
  testStatsLegacyPassMergedWithPassAdequate,
  testStatsModelFromExecutorSpawn,
  testStatsModelFromSessionIdWhenNoSpawn,
  testStatsMultiRoundSeparateGates,
  testStatsNoPricingValueIsNull,
  testStatsPlanBreakdown,
  testStatsReasonCodeBreakdown,
  testStatsSpawnModelWinsOverSessionId,
  testStatsVerdictNotesNotCappedAtDisplayLimit,
  testStatsZeroCostValueIsNull,
} from "./stats.test.js";
// Telemetry tests (split into test/telemetry/)
import {
  testTelemetryAggregatesFromRuns,
  testTelemetryPerRoundCostMultiRound,
  testTelemetryWorktreeRedacted,
} from "./telemetry/aggregates.test.js";
import {
  testTelemetryDerivedAbsentWhenEmpty,
  testTelemetryDerivedAttributesLatestGateModel,
  testTelemetryDerivedFailDragsEsExcludesCpq,
  testTelemetryDerivedMeanOfPerRunScores,
  testTelemetryDerivedShape,
  testTelemetryDerivedSkipsBytesProxyRuns,
} from "./telemetry/derived-scores.test.js";
import {
  testTelemetryDerivedExcludedFromContentCheck,
  testTelemetryDerivedToolCountsScopedToWorktrees,
} from "./telemetry/derived-tools.test.js";
import {
  testTelemetryEmptyDb,
  testTelemetryNoContentFields,
  testTelemetryPayloadShape,
  testTelemetrySchemaVersion,
  testTelemetrySentAtIso,
} from "./telemetry/payload.test.js";
import {
  testTelemetrySelfReportedFromConfig,
  testTelemetrySelfReportedRoundTrip,
} from "./telemetry/self-reported.test.js";
import {
  testClaudeCodeTimingDetail,
  testCollectTimingStepCountMirrorsDetail,
  testExtractPartTimingMalformed,
  testExtractPartTimingStepFinish,
  testExtractPartTimingToolPart,
  testOpenCodeTimingFromEmbedded,
  testOpenCodeTimingNeverLeaksIO,
  testParseTimeMsUnits,
  testRowFallbackMsVariants,
  testSummarizeTimingAverages,
  testSummarizeTimingEmpty,
  testZcodeTimingEmbeddedOnly,
} from "./timing.test.js";
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
import {
  testFmtCostNull,
  testFmtCostPositive,
  testFmtCostZero,
  testFmtDeltaNegative,
  testFmtDeltaPositive,
  testFmtDeltaZero,
  testFmtTokensMillions,
  testFmtTokensThousands,
  testFmtTokensZero,
  testRenderHtmlCostWide,
  testRenderHtmlModelNames,
  testRenderHtmlNoData,
  testRenderHtmlPollInterval,
  testRenderHtmlStructure,
  testRenderHtmlSummaryCards,
  testRenderHtmlTokenValues,
  testShortModelEmptyString,
  testShortModelJsonId,
  testShortModelJsonNoId,
  testShortModelPlainText,
} from "./usage.test.js";
import { testIsAffirmative } from "./util.test.js";

export async function cmdTest(): Promise<void> {
  console.log("running tests...\n");
  testAssertSafe();
  testAnalyzeHubOrphanCycle();
  testAnalyzeChangedUntested();
  testAnalyzeSkipsUnresolvableAndBroken();
  testAnalyzeEmptyDir();
  testAnalyzeBlastRadius();
  testAnalyzeIsTestFile();
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
  testGateOnceAlreadyStalled();
  testGateOnceMaxRounds();
  testGateOncePassExcellent();
  testGateOncePassGood();
  testGateOncePassAdequate();
  testGateOnceUncertain();
  testFindSessionModelOpenCodeHit();
  testFindSessionModelOpenCodeMiss();
  testFindSessionModelZcodeHit();
  testFindSessionModelZcodeMiss();
  testFindSessionModelZcodeMultiModel();
  testFindSessionModelZcodeSummedTokensWin();
  testFindSessionModelZcodeRawProviderPassthrough();
  testFindSessionModelOpenCodePlainTextProviderUnknown();
  testFindSessionModelClaudeCodeHit();
  testFindSessionModelClaudeCodeMiss();
  testFindSessionModelClaudeCodeMajority();
  testFindSessionModelClaudeCodeTieGoesLast();
  testFindSessionModelCodexHit();
  testFindSessionModelCodexMiss();
  testFindSessionModelCodexMultiMeta();
  testFindSessionModelCodexMultiMetaTieGoesLast();
  testFindSessionModelEmptyId();
  testFindSessionModelNoReadersAvailable();
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
  testParseTimeMsUnits();
  testExtractPartTimingToolPart();
  testExtractPartTimingStepFinish();
  testExtractPartTimingMalformed();
  testRowFallbackMsVariants();
  testSummarizeTimingAverages();
  testSummarizeTimingEmpty();
  testOpenCodeTimingFromEmbedded();
  testOpenCodeTimingNeverLeaksIO();
  testCollectTimingStepCountMirrorsDetail();
  testZcodeTimingEmbeddedOnly();
  testClaudeCodeTimingDetail();
  testContextBlockSnapshot();
  testContextBlockLowHistory();
  testContextBlockWorktreeScope();
  testContextBlockNoPatterns();
  testContextBlockLineCap();
  testContextBlockRecentNotes();
  testContextBlockFilesFilterBeyondTop3();
  testContextBlockLowHistoryStillShowsNotes();
  testContextToolEndToEnd();
  testContextToolEmptyDb();
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
  testInstallClaudeForeignStatuslineRefusesOverwrite();
  testInstallClaudeForeignScriptRefusesOverwrite();
  testInstallClaudeStatuslineWiresSettings();
  testInstallClaudeDryRunNeverAdds();
  testInstallClaudeMissingBinary();
  testInstallClaudeAddFailureHintsHelp();
  testCmdInstallDispatchesClaude();
  testLinkSkillsCreatesSymlinks();
  testLinkSkillsIdempotent();
  testLinkSkillsRefusesOverwrite();
  testLinkSkillsDryRunNoWrite();
  testCmdInstallRejectsUnknownPlatform();
  testInstallOpencodeNewFile();
  testInstallOpencodeAlreadyConfiguredNoOp();
  testInstallOpencodeDryRunNoWrite();
  testInstallOpencodeParseErrorFails();
  testCmdInstallDispatchesOpencode();
  testInstallCodexNoConfigFails();
  testInstallCodexAppendsEntry();
  testInstallCodexAlreadyConfiguredNoOp();
  testInstallCodexDryRunNoWrite();
  testCmdInstallDispatchesCodex();
  testInstallZcodeNoConfigFails();
  testInstallZcodePrimaryPath();
  testInstallZcodeFallbackPath();
  testInstallZcodeAlreadyConfiguredNoOp();
  testInstallZcodeDryRunNoWrite();
  testCmdInstallDispatchesZcode();
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
  testStatsToolGroupByReasonCode();
  testStatsToolGroupByPlan();
  testStatsToolGroupByPlanWorktreeScoped();
  testStatsToolGroupByInvalid();
  testStatsEfficiencyTextFailCensored();
  testUsageDefaultRegression();
  testUsageDetailJson();
  testUsageDetailText();
  testHandoffCollectMissingArgs();
  testHandoffCollectAutoDetectRange();
  testHandoffCollectExplicitRange();
  testHandoffCollectReturnsFiles();
  testHandoffCollectValidRepo();
  testHandoffCollectGitError();
  testHandoffCheckMissingBlock();
  testHandoffCheckGoodHandoff();
  testHandoffCheckUncertainFails();
  testHandoffCheckNotDoneFails();
  testHandoffCheckAutoGenerate();
  testHandoffCheckAutoGenerateRequiresAgentReport();
  testHandoffCheckAutoGenerateWithUncertainty();
  testHandoffCheckBlastRadiusWithWorktree();
  testHandoffCheckNoBlastRadiusWithoutWorktree();
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
  testVerdictSubmitReusesOpenRunAcrossRounds();
  testVerdictSubmitNullPlanAlwaysCreatesNew();
  testVerdictSubmitPassedRunNotReused();
  testPlanListRequiresWorktree();
  testPlanListMissingDir();
  testPlanListNeverAttempted();
  testPlanListJoinsRunHistory();
  testPlanListUsesWorktreeConfigPaths();
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
  testReadEvidenceConfigCustomPath();
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
  testVerificationReportWorktreeOnlyCreatesNoRun();
  testVerificationReportVerdictFromGateEvent();
  testVerificationReportCheckParity();
  testVerificationReportSurfacesCollectError();
  // Stats enrichment tests
  testStatsEmptyDb();
  testStatsVerdictNotesNotCappedAtDisplayLimit();
  testCountPendingPlans();
  testStatsNoPricingValueIsNull();
  testStatsZeroCostValueIsNull();
  testStatsMultiRoundSeparateGates();
  testStatsGateWithoutSpawnsInWindow();
  testStatsLegacyPassMergedWithPassAdequate();
  testStatsByWorktree();
  testStatsReasonCodeBreakdown();
  testStatsEscalatedRuns();
  testStatsPlanBreakdown();
  testFindSessionAt();
  testClaudeProjectSlug();
  testStatsBestPassing();
  testStatsByFileRisk();
  testStatsModelFromExecutorSpawn();
  testStatsModelFromSessionIdWhenNoSpawn();
  testStatsByModelGroupsByClientProviderAgent();
  testStatsSpawnModelWinsOverSessionId();
  testStatsEfficiencyUsd();
  testStatsEfficiencyBytesProxy();
  testStatsEfficiencyFailIsInfinite();
  testStatsEfficiencyJsonFailCensored();
  testStatsEfficiencyNoGateIsNull();
  testSessionDefaultHasNoDetail();
  testSessionDetailBreakdown();
  testSessionDetailSkipsUnknownType();
  testSessionDetailStepTokensNotSummed();
  testSessionDetailMatchesRawSql();
  testMergeBytesByToolSumsAcrossClients();
  testReadZcodeUsageNoDb();
  testReadZcodeUsagePrimaryPath();
  testReadZcodeUsageDetail();
  testReadZcodeUsageFilterByWorktree();
  testReadClaudeCodeUsageNoDir();
  testReadClaudeCodeUsagePrimaryPath();
  testReadClaudeCodeUsageFilterByWorktree();
  testReadClaudeCodeUsageSkipsMalformedLines();
  testReadCodexUsageNoDir();
  testReadCodexUsagePrimaryPath();
  testReadCodexUsageFilterByWorktree();
  testReadCodexUsageSkipsMalformedLines();
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
  testTelemetryDerivedAbsentWhenEmpty();
  testTelemetryDerivedShape();
  testTelemetryDerivedMeanOfPerRunScores();
  testTelemetryDerivedSkipsBytesProxyRuns();
  testTelemetryDerivedFailDragsEsExcludesCpq();
  testTelemetryDerivedAttributesLatestGateModel();
  testTelemetryDerivedToolCountsScopedToWorktrees();
  testTelemetryDerivedExcludedFromContentCheck();
  testReportHtmlTotalCostCountsEachSpawnOnce();
  testReportHtmlCanonicalQuality();
  testReportHtmlFiltersAndMethodology();
  testReportHtmlByModelHasAttributionColumns();
  testReportHtmlEscapesContent();
  // Usage-web tests
  testFmtTokensZero();
  testFmtTokensThousands();
  testFmtTokensMillions();
  testFmtCostNull();
  testFmtCostZero();
  testFmtCostPositive();
  testFmtDeltaZero();
  testFmtDeltaPositive();
  testFmtDeltaNegative();
  testShortModelJsonId();
  testShortModelJsonNoId();
  testShortModelPlainText();
  testShortModelEmptyString();
  testResolveWorktreeArgAbsolutePath();
  testResolveWorktreeArgKeyLookup();
  testResolveWorktreeArgKeyNotFound();
  testResolveWorktreeArgSentinel();
  testRenderHtmlStructure();
  testRenderHtmlModelNames();
  testRenderHtmlTokenValues();
  testRenderHtmlNoData();
  testRenderHtmlSummaryCards();
  testRenderHtmlCostWide();
  testRenderHtmlPollInterval();
  console.log("\nall tests passed ✓");
}
