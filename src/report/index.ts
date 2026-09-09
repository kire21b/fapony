// src/report/index.ts — barrel re-export

export { cmdReport, cmdReportWeb } from "./cli.js";
export {
  collectReportData,
  type GateRow,
  type ReportData,
  type RunRow,
} from "./data.js";
export { renderReportHtml } from "./render.js";
