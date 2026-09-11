// src/stats/index.ts — barrel re-export

export { cmdStats } from "./cli.js";
export {
  type BestPassing,
  computeEfficiency,
  countPendingPlans,
  type EscalatedRun,
  getBestPassing,
  getEscalatedRuns,
  getLastVerdictByPlan,
  getPlanBreakdown,
  getReasonCodeBreakdown,
  getRecentFailNotes,
  getStatsData,
  type PlanBreakdown,
  type PlanLastVerdict,
  type ReasonCodeCount,
  type RecentFailNote,
  type RunEfficiency,
  resolveMaxRounds,
  type StatsData,
} from "./data.js";
export { formatStatsText } from "./format.js";
