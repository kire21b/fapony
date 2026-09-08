// test/mcp/helpers.ts — re-export shared helpers for MCP tests
// (defines the same module boundary as the handcheck tests expect)

export {
  baseConfig,
  silentErrors,
  withTempRepo,
  withTmpDb,
  withTmpDbAsync,
} from "../helpers.js";
