// src/stats/cli.ts — cmdStats CLI entry point

import { getStatsData } from "./data.js";
import { formatStatsText } from "./format.js";

export function cmdStats(_args: string[]): void {
  console.log(formatStatsText(getStatsData()));
}
