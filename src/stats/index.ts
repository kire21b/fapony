// src/stats/index.ts — barrel re-export

export { cmdStats } from "./cli.js";
export {
  type BestPassing,
  computeEfficiency,
  type EscalatedRun,
  getBestPassing,
  getEscalatedRuns,
  getPlanBreakdown,
  getReasonCodeBreakdown,
  getRecentFailNotes,
  getStatsData,
  type PlanBreakdown,
  type ReasonCodeCount,
  type RecentFailNote,
  type RunEfficiency,
  resolveMaxRounds,
  type StatsData,
} from "./data.js";
export { formatStatsText } from "./format.js";
