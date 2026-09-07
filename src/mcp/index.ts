// src/mcp/index.ts — barrel re-export

export {
  extractMultiField,
  TOOLS,
  toolHandoffCheck,
  toolHandoffCollect,
  toolVerdictSubmit,
} from "./tools/index.js";
export { cmdMcp, dispatch } from "./transport.js";
export type { ReasonCode, ToolResult } from "./types.js";
export {
  errorResult,
  jsonResult,
  parseToolResult,
  REASON_CODES,
} from "./types.js";
