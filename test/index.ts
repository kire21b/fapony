// test/index.ts — test runner. Import all test modules and run sequentially.

import {
  testAutoArchivePlanKeepsExistingHeader,
  testAutoArchivePlanMissingFile,
  testAutoArchivePlanNormalizesLinks,
  testAutoArchivePlanSynthesizesHeader,
} from "./archive.test.js";
import {
  testConfigDefaults,
  testConfigDriftWarning,
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
import {
  testDbLifecycle,
  testGetLastPlanUpdate,
  testLegacyDbStampedWithoutDataLoss,
  testMigrateDbRejectsNewerSchema,
  testSchemaVersionStamped,
} from "./db.test.js";
import {
  testGateOnceAlreadyPassed,
  testGateOnceFail,
  testGateOnceMaxRounds,
  testGateOncePass,
} from "./gate.test.js";
import {
  testParseHandoff,
  testParseHandoffMultiLine,
  testRenderHandoff,
  testRenderHandoffGitError,
} from "./handoff.test.js";
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
  testEndToEndPipeline,
  testErrorResult,
  testExtractMultiFieldEmptyLineEndsField,
  testExtractMultiFieldMultiLine,
  testExtractMultiFieldNone,
  testExtractMultiFieldNotFound,
  testExtractMultiFieldSingle,
  testHandoffCheckAutoGenerate,
  testHandoffCheckAutoGenerateRequiresFacts,
  testHandoffCheckGoodHandoff,
  testHandoffCheckMissingBlock,
  testHandoffCheckMultiLineUncertain,
  testHandoffCheckNotDoneFails,
  testHandoffCheckUncertainFails,
  testHandoffCheckWithFactsCrossRef,
  testHandoffCheckWithoutFacts,
  testHandoffCollectAutoDetectRange,
  testHandoffCollectExplicitRange,
  testHandoffCollectGitError,
  testHandoffCollectMissingArgs,
  testHandoffCollectValidRepo,
  testJsonResult,
  testMcpInitialize,
  testMcpNotificationsIgnored,
  testMcpToolsCallUnknownTool,
  testMcpToolsList,
  testMcpUnknownMethod,
  testParseToolResult,
  testReasonCodesAreLocked,
  testVerdictSubmitAutoCreatesRun,
  testVerdictSubmitInvalidReasonCode,
  testVerdictSubmitInvalidVerdict,
  testVerdictSubmitOtherRequiresNote,
  testVerdictSubmitRunNotFound,
  testVerdictSubmitStoresMcpSource,
  testVerdictSubmitSuccess,
} from "./mcp.test.js";
import {
  testClaimMemoryFailGracefully,
  testClaimMemoryTimeout,
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
  testPlanHygieneEnglishNoneNoLeak,
  testPlanHygieneHeadingVariant,
  testPlanHygieneNoSpecNoLeakWarning,
  testPlanHygieneOk,
  testPlanHygieneSpecLeak,
  testPlanHygieneTooLong,
} from "./planlint.test.js";
import {
  testPlanMvAlreadyDatedNotDoublePrefixed,
  testPlanMvDestCollision,
  testPlanMvDryRun,
  testPlanMvInboundLinks,
  testPlanMvMissingFile,
  testPlanMvNoHeader,
  testPlanMvNormalizeLinks,
  testPlanMvWithHeader,
} from "./planmv.test.js";
import {
  testBackoffCappedAtMax,
  testBackoffExponential,
  testBackoffJitterRange,
  testClassifyAuth,
  testClassifyCrash,
  testClassifyCustomPatterns,
  testClassifyEmpty,
  testClassifyEmptyExitZeroStderrAuth,
  testClassifyLimit,
  testClassifyLimit429,
  testClassifyLimitNeedsContext,
  testClassifyTailTruncated,
  testClassifyTimeout,
  testFlakyAgentRetriesAndSucceeds,
  testIsSigintReceivedDefaultFalse,
  testSigintHandlerMarksStopped,
  testSleepInterruptibleAborts,
  testSleepInterruptibleCompletes,
  testWithRetryAbortedBeforeAttempt,
  testWithRetryAuthNotRetried,
  testWithRetryCanRetryGateBlocks,
  testWithRetryExhausts,
  testWithRetrySucceedsAfterTwoFails,
  testWithRetrySucceedsFirstTry,
  testWithRetryTerminalAttemptNumber,
  testWithRetryTimeoutNotRetried,
} from "./resilience.test.js";
import {
  testBuildExecutorPrompt,
  testExecutorCmdRolePreference,
  testRunOnceAbortedMarksStopped,
} from "./run.test.js";
import { testAssertNoPromptInArgv, testAssertSafe } from "./safety.test.js";
import {
  testBuildScrutinizePrompt,
  testResolveChangedFiles,
  testShouldScrutinizeFix,
  testSpawnRejectsPromptPlaceholder,
  testSpawnScrutinizeFix,
  testSpawnScrutinizeFixRejectsDangerousCmd,
} from "./scrutinize.test.js";
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
  testParseTimeoutMinutes,
  testShouldOverwriteConfig,
  testSplitCmdEmptyQuotedString,
  testSplitCmdEmptyString,
  testSplitCmdMultipleQuotedArgs,
  testSplitCmdNoQuotes,
  testSplitCmdQuotedArg,
  testSplitCmdSimpleArgs,
  testSplitCmdSingleQuotedArg,
  testValidateWorktreePath,
  testValidateWorktreePathRejectsFile,
} from "./setup.test.js";
import {
  testSigintMarksStoppedAndLogs,
  testSigintSkipsTerminalRuns,
} from "./sigint.test.js";
import {
  testStatusTableShowsNothingWhenEmpty,
  testStatusTableShowsPlanAndMemId,
  testStatusTableTruncatesLongMemId,
} from "./status.test.js";
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
  testParseHandoff();
  testParseHandoffMultiLine();
  testDbLifecycle();
  testSchemaVersionStamped();
  testLegacyDbStampedWithoutDataLoss();
  testMigrateDbRejectsNewerSchema();
  testRenderHandoff();
  testRenderHandoffGitError();
  await testParseGateVerdict();
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
  testPlanMvMissingFile();
  testPlanMvDestCollision();
  testPlanMvInboundLinks();
  testPlanMvAlreadyDatedNotDoublePrefixed();
  testClassifyAuth();
  testClassifyTimeout();
  testClassifyLimit();
  testClassifyLimit429();
  testClassifyCrash();
  testClassifyEmpty();
  testClassifyEmptyExitZeroStderrAuth();
  testClassifyTailTruncated();
  testClassifyCustomPatterns();
  testClassifyLimitNeedsContext();
  testBackoffExponential();
  testBackoffCappedAtMax();
  testBackoffJitterRange();
  await testSleepInterruptibleCompletes();
  await testSleepInterruptibleAborts();
  await testWithRetrySucceedsFirstTry();
  await testWithRetrySucceedsAfterTwoFails();
  await testWithRetryExhausts();
  await testWithRetryAuthNotRetried();
  await testWithRetryTimeoutNotRetried();
  await testWithRetryAbortedBeforeAttempt();
  await testWithRetryTerminalAttemptNumber();
  await testWithRetryCanRetryGateBlocks();
  await testFlakyAgentRetriesAndSucceeds();
  await testSigintHandlerMarksStopped();
  testIsSigintReceivedDefaultFalse();
  await testSigintMarksStoppedAndLogs();
  await testSigintSkipsTerminalRuns();
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
  testClaimMemoryFailGracefully();
  testClaimMemoryTimeout();
  testShouldScrutinizeFix();
  testBuildScrutinizePrompt();
  testResolveChangedFiles();
  await testSpawnScrutinizeFix();
  await testSpawnScrutinizeFixRejectsDangerousCmd();
  await testSpawnRejectsPromptPlaceholder();
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
  testConfigDriftWarning();
  testBuildExecutorPrompt();
  testExecutorCmdRolePreference();
  await testRunOnceAbortedMarksStopped();
  testPlanHygieneOk();
  testPlanHygieneTooLong();
  testPlanHygieneSpecLeak();
  testPlanHygieneNoSpecNoLeakWarning();
  testPlanHygieneEnglishNoneNoLeak();
  testPlanHygieneHeadingVariant();
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
  testSplitCmdSingleQuotedArg();
  testBuildSetupConfigNoMemory();
  testBuildSetupConfigWithMemory();
  testValidateWorktreePath();
  testValidateWorktreePathRejectsFile();
  testShouldOverwriteConfig();
  testParseTimeoutMinutes();
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
  // MCP handcheck tests
  testMcpInitialize();
  testMcpToolsList();
  testMcpNotificationsIgnored();
  testMcpUnknownMethod();
  testMcpToolsCallUnknownTool();
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
  testHandoffCheckAutoGenerateRequiresFacts();
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
  console.log("\nall tests passed ✓");
}
