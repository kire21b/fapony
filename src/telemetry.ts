import { openDb, loadConfig, type Run, type Event } from "./db.js";
import { sumSpawnCost } from "./cost.js";

// Exact payload shape sent when `fapony telemetry send` runs — see TELEMETRY.md.
// No plan text, commit messages, or gate notes: only the `data` column of
// events is dropped, everything else here is structural/timing.
// Cost is allowlisted numbers (bytes/usd/spawns per run) derived from spawn
// events — never raw `data` (which holds plan/commit/gate-note content).
export interface TelemetryPayload {
  sent_at: string;
  runs: Array<Pick<Run, "id" | "worktree" | "status" | "round" | "created_at" | "updated_at">>;
  events: Array<{ run_id: number; kind: string; ts: string }>;
  cost: Array<{ run_id: number; spawns: number; bytes_in: number; bytes_out: number; usd_estimate: number | null }>;
}

export function buildPayload(): TelemetryPayload {
  const db = openDb();
  const runs = db
    .prepare(
      "SELECT id, worktree, status, round, created_at, updated_at FROM runs ORDER BY id"
    )
    .all() as TelemetryPayload["runs"];
  const events = db
    .prepare("SELECT run_id, kind, ts FROM events ORDER BY run_id, id")
    .all() as TelemetryPayload["events"];
  const costEvents = db
    .prepare("SELECT * FROM events WHERE kind = 'spawn' ORDER BY run_id, id")
    .all() as Event[];
  const byRun: Record<number, Event[]> = {};
  for (const e of costEvents) (byRun[e.run_id] ??= []).push(e);
  const cost = Object.entries(byRun).map(([runId, es]) => {
    const c = sumSpawnCost(es);
    return {
      run_id: Number(runId),
      spawns: c.spawns,
      bytes_in: c.bytes_in,
      bytes_out: c.bytes_out,
      usd_estimate: c.usd_estimate,
    };
  });
  return { sent_at: new Date().toISOString(), runs, events, cost };
}

export async function cmdTelemetry(args: string[]): Promise<void> {
  const sub = args[0];
  const payload = buildPayload();

  if (sub === "show" || !sub) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (sub === "send") {
    const config = loadConfig();
    if (!config.telemetry?.enabled) {
      console.error(
        'telemetry is off — set "telemetry": { "enabled": true, "endpoint": "https://..." } in fapony.config.json to turn it on'
      );
      process.exit(1);
    }
    const res = await fetch(config.telemetry.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`telemetry send failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    console.log(
      `sent ${payload.runs.length} runs / ${payload.events.length} events / ${payload.cost.length} cost entries to ${config.telemetry.endpoint}`
    );
    return;
  }

  console.error(`fapony telemetry: unknown subcommand "${sub}"`);
  console.error("usage: fapony telemetry <show|send>");
  process.exit(1);
}
