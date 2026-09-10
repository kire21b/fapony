// src/mcp/index.ts — barrel re-export

export type {
  CheckResult,
  EvidenceItem,
  EvidenceProvenance,
  EvidenceStatus,
  EvidenceSummary,
  VerificationReport,
} from "./primitives.js";
export {
  computeEvidenceSummary,
  EVIDENCE_STATUSES,
  getServerSha,
  renderReportText,
} from "./primitives.js";
export {
  extractMultiField,
  TOOLS,
  toolHandoffCheck,
  toolHandoffCollect,
  toolPassiveUsage,
  toolVerdictSubmit,
  toolVerificationReport,
} from "./tools/index.js";
export { cmdMcp, dispatch } from "./transport.js";
export type { ReasonCode, ToolResult } from "./types.js";
export {
  errorResult,
  jsonResult,
  parseToolResult,
  REASON_CODES,
} from "./types.js";
