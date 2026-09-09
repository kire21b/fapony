// src/stats.ts — backward-compat re-export (actual code moved to src/stats/)

export { cmdStats } from "./stats/cli.js";
export {
  computeEfficiency,
  getStatsData,
  type RunEfficiency,
  type StatsData,
} from "./stats/data.js";
export { formatStatsText } from "./stats/format.js";
