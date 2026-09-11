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
  getRecentVerdictNotes,
  getStatsData,
  type PlanBreakdown,
  type PlanLastVerdict,
  type ReasonCodeCount,
  type RecentVerdictNote,
  type RunEfficiency,
  resolveMaxRounds,
  type StatsData,
} from "./data.js";
export { formatStatsText } from "./format.js";
