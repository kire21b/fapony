# SPEC-config-schema-cleanup.md — trim the config schema back to what MCP actually reads

> **Used by:** [PLAN-config-schema-cleanup.md](../plan/done/2026-09-09-PLAN-config-schema-cleanup.md)

---

## Shape (what stays, what goes)

Live-caller audit as of commit 629b33c (`git grep '\bgetterName(' src --include='*.ts'`,
excluding the getter's own definition file and `*.test.ts`). Re-run this grep before
executing — the branch may have drifted.

### `src/db/types.ts` — `Config` interface

| Field | Verdict | Why |
|---|---|---|
| `worktrees` | **keep** | `gate.ts`, `mcp/tools/report.ts` resolve worktree paths |
| `executor` | **drop** | zero readers — no live code spawns an agent anymore |
| `roles.*.cmd` / `roles.*.timeoutMin` | **drop sub-fields** | unread; only `roles.*.model` is read (by `roleModel()` in `cost.ts`, cost attribution) |
| `roles.*.model` | **keep** | `cost.ts` |
| `review.bigDiff` / `.gate` / `.prefilter` / `.autoLoop` | **drop** | routing/reviewer-spawn only, both gone |
| `review.maxRounds` | **keep** | `gate.ts` (`gateOnce` round-cap check) |
| `memory` | **keep** | `gate.ts` (`closeMemory`/`kickoffMemory`), `init.ts` scaffold |
| `pricing` | **keep** | `cost.ts` (`pricingFor`) — dormant until something writes spawn events again, but that's the benchmark direction, not dead code |
| `telemetry` | **keep** | `telemetry.ts` |
| `prompts` | **drop** | fed `promptFileFor()`, zero readers of that getter |
| `spec` (`maxLines`, `sourceMarker`) | **drop** | fed `specMaxLines`/`sourceSpecRE`/`planMaxLines`, zero readers |
| `markers` (`handoff`/`verdict`/`nextPrompt`/`fileDone`/`shipped`) | **drop** | fed `parseGateVerdict`/`parsePlanUpdate` (text-marker parsing) — those have zero live callers now; gate events are read as JSON via `parseGateEventData`, never as `VERDICT:` text |
| `paths.stateDir` | **keep** | `db/load.ts` (`faponyDir`) |
| `paths.planDir` / `.specDir` / `.memoryEntry` | **keep** | `init.ts`, `memory.ts` scaffold |
| `paths.doneDir` / `.linkScanDirs` | **drop** | `plan-mv`-only, deleted in Wave 2 |
| `safety.deny` | **keep** | `memory.ts`, `mcp/evidence.ts` |
| `plan` (`extensions`, `maxLines`) | **drop** | `planlint`/`plans.ts`-only, deleted in Wave 2 |
| `planmv` | **drop** | `planmv.ts`-only, deleted in Wave 2 |
| `display` (`dirtyPreview`, `shortSha`) | **drop** | `run/guard.ts`/`handoff.ts`-only, deleted in Wave 2 |
| `defaults.timeoutMin` | **drop** | fed `roleTimeoutMin()`, zero live callers (no role spawn left to time out) |
| `resilience` | **drop** | `resilience.ts`-only, deleted in Wave 2 |

### `src/db/getters.ts` — drop these (zero live callers once the fields above are gone)

`specMaxLines`, `planMaxLines`, `sourceSpecRE`, `handoffMarker`, `verdictRE`,
`nextPromptMarker`, `fileDoneMarker`, `shippedRE`, `doneDirName`, `linkScanDirs`,
`planExtensions`, `archiveMsg`, `inboundWarnAt`, `dirtyPreviewLines`, `shortShaLen`,
`roleTimeoutMin`, `promptFileFor`, `resilienceEnabled`, `retryPolicy`, `resiliencePatterns`.

Keep: `safetyDeny`, `planDir`, `specDir`, `memoryEntry`, `roleModel`, `pricingFor`.

### `src/db/defaults.ts`

Drop every `DEFAULT_*` constant that only fed a dropped getter (mirror the getters list
above 1:1 — e.g. `DEFAULT_HANDOFF_MARKER` goes with `handoffMarker`). Keep the constants
behind the kept getters (`DEFAULT_SAFETY_DENY`, `DEFAULT_PLAN_DIR`, `DEFAULT_SPEC_DIR`,
`DEFAULT_MEMORY_ENTRY`) and `DEFAULT_CONFIG` itself, trimmed to match the shrunk `Config`.

### `src/db/load.ts`

- `freshDefaultConfig()` and `loadConfig()`: drop the `executor` spread/merge and the B2
  drift-warning block (`file.executor?.cmd && file.roles?.executor?.cmd`) — both existed
  only to reconcile `executor.cmd` vs `roles.executor.cmd`, and `executor` is gone.
- Drop the merge lines for `spec`, `markers`, `plan`, `planmv`, `display`, `defaults`,
  `prompts` (dropped fields). Keep the `paths`/`safety` merge (fields survive, just fewer
  of them) and shrink the `review` merge to `maxRounds` only (drop `bigDiff`).

### `src/db/store.ts`

Drop `getLastPlanUpdate()` — doc comment says "Used by loop.ts"; loop.ts is gone and grep
confirms no other caller.

### `src/parse.ts`

Drop `parseGateVerdict()` and `parsePlanUpdate()` (plus the now-unused `PlanUpdate`
interface) — both parsed marker text (`VERDICT:` / `## NEXT-PROMPT` / `## FILE_DONE`) from
raw agent stdout, which nothing produces anymore (gate events are JSON, not text).

Keep: `VERDICT_GRADES`, `isPassFamily`, `qualityScore`, `GateVerdict` interface (still the
return type of the live `parseGateEventData`), `parseGateEventData` itself.

### Non-code

- `fapony.config.example.json` — trim to match the shrunk schema.
- `README.md` § Config — update the bullet list (drop `executor.cmd`/`review.bigDiff`/
  `review.gate`/`prompts`/`markers`/`paths`/`safety` deny-list mention stays since safety
  survives — reread the section, don't guess).

## Edge cases

| Case | Expected |
|---|---|
| Existing `fapony.config.json` in the wild still has `executor`/`roles.executor.cmd`/etc. | `loadConfig()` spreads `...file` first, so unknown keys just ride along harmlessly in the returned object — no crash, no silent data loss, they're just never read. No migration needed. |
| A test asserts a dropped getter's default | Delete that assertion, don't stub around it |
| `roleModel`/`pricingFor` after `roles.*.cmd`/`timeoutMin` sub-fields drop | Only `.model` is typed now — `cost.ts` callsites don't touch `.cmd`/`.timeoutMin`, no change needed there |

## Examples

Before (`Config.review`):
```ts
review: {
  bigDiff: { files: number; lines: number };
  maxRounds: number;
  gate: string[];
  prefilter: null;
  autoLoop?: boolean;
};
```
After:
```ts
review: { maxRounds: number };
```
