import { openDb, type Run, type Event } from "./db/index.js";
import { sumSpawnCost } from "./cost.js";

function minutesBetween(a: string, b: string): number {
  const t0 = new Date(a.replace(" ", "T") + "Z").getTime();
  const t1 = new Date(b.replace(" ", "T") + "Z").getTime();
  return (t1 - t0) / 60000;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

// Walks events per run in order and pairs up spawn→route (executor time)
// and route→gate (review turnaround) per round, since one run row can span
// multiple rounds (spawn/commit/route/gate repeating).
function stageMinutes(events: Event[]): { exec: number[]; review: number[] } {
  const exec: number[] = [];
  const review: number[] = [];
  let spawnTs: string | null = null;
  let routeTs: string | null = null;

  for (const e of events) {
    if (e.kind === "spawn") spawnTs = e.ts;
    else if (e.kind === "route") {
      if (spawnTs) exec.push(minutesBetween(spawnTs, e.ts));
      routeTs = e.ts;
    } else if (e.kind === "gate") {
      if (routeTs) review.push(minutesBetween(routeTs, e.ts));
      routeTs = null;
    }
  }
  return { exec, review };
}

export function cmdStats(_args: string[]): void {
  const db = openDb();
  const runs = db.prepare("SELECT * FROM runs ORDER BY id").all() as Run[];

  if (runs.length === 0) {
    console.log("no runs yet");
    return;
  }

  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const terminal = runs.filter((r) =>
    ["passed", "stopped", "stalled"].includes(r.status)
  );
  const passed = runs.filter((r) => r.status === "passed");

  const passRate = terminal.length ? passed.length / terminal.length : 0;
  const stallRate = terminal.length
    ? (byStatus.stalled ?? 0) / terminal.length
    : 0;
  const avgRounds = passed.length
    ? passed.reduce((s, r) => s + r.round, 0) / passed.length
    : 0;
  const avgMinutes = passed.length
    ? passed.reduce((s, r) => s + minutesBetween(r.created_at, r.updated_at), 0) /
      passed.length
    : 0;

  console.log(`runs: ${runs.length}  (${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ")})`);
  console.log(`pass rate: ${(passRate * 100).toFixed(0)}%  stall rate: ${(stallRate * 100).toFixed(0)}%`);
  console.log(`avg rounds to pass: ${avgRounds.toFixed(1)}  avg time to pass: ${avgMinutes.toFixed(0)}m`);

  const events = db
    .prepare("SELECT * FROM events ORDER BY run_id, id")
    .all() as Event[];
  const eventsByRun: Record<number, Event[]> = {};
  for (const e of events) (eventsByRun[e.run_id] ??= []).push(e);

  // Cost total across all runs (bytes always, USD only when pricing set).
  // Deliberately no breakdown by role/worktree/pass — add when a real
  // question needs it (PLAN-cost-routing §ไม่ทำ).
  const total = sumSpawnCost(events);
  if (total.spawns > 0) {
    const usd = total.usd_estimate !== null ? ` (~$${total.usd_estimate.toFixed(4)} est.)` : "";
    console.log(
      `cost: ${total.bytes_in} bytes in / ${total.bytes_out} bytes out over ${total.spawns} spawns${usd}`
    );
  }

  const execAll: number[] = [];
  const reviewAll: number[] = [];
  for (const es of Object.values(eventsByRun)) {
    const { exec, review } = stageMinutes(es);
    execAll.push(...exec);
    reviewAll.push(...review);
  }
  console.log(
    `avg exec time (spawn→route): ${avg(execAll).toFixed(1)}m over ${execAll.length} rounds`
  );
  console.log(
    `avg review turnaround (route→gate): ${avg(reviewAll).toFixed(1)}m over ${reviewAll.length} rounds`
  );

  const byWorktree: Record<string, Run[]> = {};
  for (const r of runs) (byWorktree[r.worktree] ??= []).push(r);

  console.log("\nby worktree:");
  console.log("  worktree | runs | passed | stalled");
  console.log("  ---------|------|--------|--------");
  for (const [wt, rs] of Object.entries(byWorktree)) {
    const p = rs.filter((r) => r.status === "passed").length;
    const s = rs.filter((r) => r.status === "stalled").length;
    console.log(`  ${wt.padEnd(8)} | ${String(rs.length).padStart(4)} | ${String(p).padStart(6)} | ${String(s).padStart(7)}`);
  }
}
