# Changelog

## 2026-09-06 — cost measurement slice (PLAN-cost-routing)

- Every agent spawn (`executor`, `gate`, `planner`, `bigFixer`,
  `scrutinizeFix`) now logs `role`/`model` + byte input/output into the
  existing `spawn` event row (`events.data` only — no new table, no new
  event kind). Bytes are a declared proxy, not real token usage.
- Optional static `pricing` config (`{ "<role>": { "inputPer1k",
  "outputPer1k" } }`, USD per 1k tokens) adds a `usd_estimate` labeled
  as estimate-only. `pricing: null` keeps byte measurement, disables USD.
- `fapony stats` prints a total cost line, `fapony handoff` prints an
  additive `--- cost ---` section, and opt-in telemetry gains an
  allowlisted `cost` array (`run_id`/`spawns`/`bytes_in`/`bytes_out`/
  `usd_estimate` — no plan/note/commit content, ever).

Decision record (router gate 2g): dogfood ran 2 stub rounds on `wt-fapony`
(12026 bytes in / 124 bytes out per round; priced round ≈ $9.48 est. at
3.0/15.0 per 1k). Single role, stub output — no evidence for
file/line-count thresholds, so **no `pickExecutorRole`, no threshold
routing**; single executor role stays until real multi-role data exists.
