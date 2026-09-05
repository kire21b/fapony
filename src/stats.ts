import { openDb, type Run } from "./db.js";

function minutesBetween(a: string, b: string): number {
  const t0 = new Date(a.replace(" ", "T") + "Z").getTime();
  const t1 = new Date(b.replace(" ", "T") + "Z").getTime();
  return (t1 - t0) / 60000;
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
