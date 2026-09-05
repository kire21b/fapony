# Telemetry

Off by default. Nothing leaves your machine unless you turn it on.

## What gets sent (only when you run `fapony telemetry send`)

- **runs**: `id`, `worktree`, `status`, `round`, `created_at`, `updated_at`
- **events**: `run_id`, `kind` (spawn/commit/route/gate/stalled/...), `ts`

## What never gets sent

- `events.data` — this is where plan text, commit hashes+messages, gate
  review notes, and `NEXT-PROMPT`/`FILE_DONE` planner output live. It is
  never read or included.
- Anything from the worktree itself (source code, diffs, file contents).
- `mem_id` (may correlate with your product's memory system).

Run `fapony telemetry show` any time to print the exact JSON payload before
deciding whether to send it — it's the same code path `send` uses.

## Turning it on

Off unless both are set in `fapony.config.json`:

```json
"telemetry": { "enabled": true, "endpoint": "https://your-server/ingest" }
```

`fapony telemetry send` is a manual command — nothing runs automatically in
the background or as part of `fapony run`/`loop`/`gate`. There is no default
endpoint; you point it at a server you control.

`endpoint` just needs to accept a `POST` with a JSON body (see
`TelemetryPayload` in [src/telemetry.ts](src/telemetry.ts)) — no fapony-side
server exists yet, this only builds and sends the payload.
