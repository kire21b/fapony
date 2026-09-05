import { openDb, loadConfig, type Run } from "./db.js";

// Exact payload shape sent when `fapony telemetry send` runs — see TELEMETRY.md.
// No plan text, commit messages, or gate notes: only the `data` column of
// events is dropped, everything else here is structural/timing.
export interface TelemetryPayload {
  sent_at: string;
  runs: Array<Pick<Run, "id" | "worktree" | "status" | "round" | "created_at" | "updated_at">>;
  events: Array<{ run_id: number; kind: string; ts: string }>;
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
  return { sent_at: new Date().toISOString(), runs, events };
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
      `sent ${payload.runs.length} runs / ${payload.events.length} events to ${config.telemetry.endpoint}`
    );
    return;
  }

  console.error(`fapony telemetry: unknown subcommand "${sub}"`);
  console.error("usage: fapony telemetry <show|send>");
  process.exit(1);
}
