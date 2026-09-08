# SPEC-verification-report — verification report contract

> **Used by:** [PLAN-verification-report.md](../plan/PLAN-verification-report.md)

---

## 1. Purpose

Define the single report shape that `verification_report` MCP tool returns.
Composes results from existing primitives (handoff_collect, handoff_check,
verdict, stats) plus evidence collection — no new parser/conformance logic.

## 2. Report contract (VerificationReport)

```jsonc
{
  "facts": { /* from handoff_collect — verified by fapony */ },
  "handoff_checks": { /* from handoff_check — or null */ },
  "evidence": [ /* EvidenceItem[] — test/typecheck/lint results */ ],
  "evidence_summary": { /* computed from evidence[] */ },
  "verdict": { "grade": "pass-good", "note": "..." } | null,
  "duration_ms": 12500,
  "rounds": 1,
  "cost": { /* from spawn events — bytes proxy, USD est. only */ },
  "meta": { "generated_at": "...", "source": "fapony_mcp", "run_id": 42 }
}
```

### 2.1 `facts` — Git facts (from handoff_collect)

Identical shape to `handoff_collect` output. Source: fapony runs git
directly. Provenance: `verified: true, source: "git_cli"`.

```jsonc
{
  "files_changed": 3,
  "lines_changed": 120,
  "insertions": 80,
  "deletions": 40,
  "commits": ["a1b2c3d", "e4f5g6h"],
  "branch": "feature/auth",
  "git_error": null  // or error string
}
```

### 2.2 `handoff_checks` — Conformance (from handoff_check)

Identical shape to `handoff_check` output. `null` when no handoff
text is available (e.g. standalone mode without fapony run).

```jsonc
{
  "checks": [
    { "name": "has_handoff_block", "pass": true, "note": "" },
    { "name": "claimed_matches_commits", "pass": true, "note": "..." },
    { "name": "uncertain_not_empty", "pass": true, "note": "" },
    { "name": "not_done_not_empty", "pass": true, "note": "" },
    { "name": "checks_declared", "pass": true, "note": "" },
    { "name": "facts_cross_referenced", "pass": true, "note": "..." }
  ],
  "summary": {
    "total": 6,
    "passed": 6,
    "failed": 0,
    "needs_human_review": false
  }
}
```

### 2.3 `evidence` — Evidence items

Each item represents one verification command (test, typecheck, lint, etc.).

```jsonc
{
  "command": "bun test",
  "status": "passed",         // EvidenceStatus enum (5 values)
  "exit_code": 0,
  "duration_ms": 1200,
  "provenance": {
    "verified": true,         // true = fapony ran it; false = agent claim
    "source": "fapony_cli"    // "fapony_cli" | "agent_report" | "config_allowlist"
  },
  "note": null                // optional: reason for not_run, timeout, etc.
}
```

### 2.4 `evidence_summary` — Computed from evidence[]

```jsonc
{
  "total": 3,
  "passed": 2,
  "failed": 0,
  "not_run": 1,
  "unverified": 0,
  "timeout": 0
}
```

### 2.5 `verdict` — From gate/verdict_submit

Grade is one of the 6 locked values. `null` when no verdict submitted yet.

### 2.6 `cost` — From spawn events

```jsonc
{
  "spawns": 2,
  "bytes_in": 5000,
  "bytes_out": 3000,
  "usd_estimate": 0.045  // or null when pricing unset — never 0-as-fake
}
```

## 3. Evidence status vocabulary (locked, additive-only)

| Status | Meaning |
|--------|---------|
| `passed` | Command exited 0, output matches expectation |
| `failed` | Command exited non-zero or output mismatch |
| `not_run` | Command not configured or explicitly skipped |
| `unverified` | Agent claim, not yet re-run by fapony |
| `timeout` | Command exceeded per-command timeout |

Source: `EVIDENCE_STATUSES` in `src/mcp/primitives.ts`.
Additive-only: append new values, never rename/remove.

## 4. Evidence allowlist strategy

**Decision: option (c) — mixed.**

- Allowlist lives in `.fapony/evidence.json` inside the worktree (read-only,
  fapony never writes to worktree by rule #5).
- Agent can also propose commands — they get `unverified` provenance.
- fapony re-runs allowlisted commands itself → `verified` provenance.

### 4.1 `.fapony/evidence.json` shape

```jsonc
{
  "commands": [
    { "name": "test", "cmd": "bun test", "timeout_ms": 30000 },
    { "name": "typecheck", "cmd": "bun run typecheck", "timeout_ms": 15000 },
    { "name": "lint", "cmd": "bun run lint", "timeout_ms": 15000 }
  ]
}
```

- `name`: human label displayed in report
- `cmd`: shell command to run (cwd = worktree)
- `timeout_ms`: per-command timeout (default 30000 if omitted)
- Missing file = no allowlisted commands = all evidence from agent = `unverified`

### 4.2 Agent-proposed commands

When agent calls `verification_report` with `evidence_commands: ["cargo test"]`:
- Commands NOT in allowlist → status `unverified`, provenance `agent_report`
- Commands IN allowlist → fapony runs them → status from actual result, provenance `fapony_cli`

## 5. Evidence timeout & concurrency

- Each command runs sequentially (no parallel execution — simpler, deterministic timing).
- Per-command timeout from `.fapony/evidence.json` or default 30s.
- Timeout → status `timeout`, note `"exceeded ${timeout_ms}ms"`, does not block other commands.
- Total report generation timeout: 60s (hard cap). If exceeded, remaining commands → `timeout`.

## 6. Provenance rules

| Source | Provenance |
|--------|-----------|
| `handoff_collect` (fapony runs git) | `verified: true, source: "git_cli"` |
| `handoff_check` (fapony checks) | `verified: true, source: "fapony_check"` |
| Allowlisted command (fapony runs) | `verified: true, source: "fapony_cli"` |
| Agent-proposed command | `verified: false, source: "agent_report"` |
| Agent claim in handoff text | `verified: false, source: "agent_report"` |
| Verdict from gate/verdict_submit | `verified: true, source: "fapony_gate"` |

Rules:
- fapony-ran results = `verified`; agent claims = `unverified` until cross-referenced.
- `unverified` is not "wrong" — it means "trust but verify".

## 7. Backward compatibility

- `handoff_collect`, `handoff_check`, `verdict_submit`, `fapony_stats` remain
  unchanged. The verification_report tool composes their outputs, does not replace them.
- `VerificationReport.facts` is the same shape as `handoff_collect` output.
- `VerificationReport.handoff_checks` is the same shape as `handoff_check` output.
- `VerificationReport.cost` is the same shape as `sumSpawnCost()` return value.
- Old event data in `events.data` is still readable — field additions are additive-only.

## 8. MCP tool: `verification_report`

### Input

```jsonc
{
  "run_id": 42,                          // optional — resolve from DB
  "worktree": "/path/to/repo",           // optional — defaults to configured worktree
  "base_sha": "abc123",                  // optional — for handoff_collect
  "head_sha": "def456",                  // optional — for handoff_collect
  "handoff": "## HANDOFF\n...",          // optional — agent's handoff text
  "evidence_commands": ["cargo test"],   // optional — additional commands to check
  "format": "text"                       // optional — "text" (default) or "json"
}
```

### Output (format: "text")

Human-readable text — same structure as `renderReportText()` in primitives.ts.
Sections: git facts → handoff conformance → evidence → verdict → duration → cost → next action.

### Output (format: "json")

`VerificationReport` object — machine-readable, same data as text.

## 9. Edge cases

| Scenario | Behavior |
|----------|----------|
| No `run_id`, no `worktree` | Error: "provide run_id or worktree" |
| `run_id` not found | Error: "run not found" |
| No `.fapony/evidence.json` | All evidence from agent → `unverified` |
| Evidence command fails to execute | status `failed`, note = error message |
| No handoff text provided | `handoff_checks` = null, other sections still populated |
| No verdict yet | `verdict` = null, next action = "Submit a verdict" |
| Git diff fails | `facts.git_error` set, other facts zeroed |
| Timeout on evidence command | status `timeout`, continues to next command |

## 10. Examples

### Example: passing report

```text
=== Verification Report ===
run: 42  generated: 2026-09-08T12:00:00Z

--- git facts ---
branch: feature/auth
files changed: 3
lines changed: 120
commits: a1b2c3d, e4f5g6h

--- handoff conformance ---
6/6 passed
  ✓ has_handoff_block
  ✓ claimed_matches_commits
  ✓ uncertain_not_empty
  ✓ not_done_not_empty
  ✓ checks_declared
  ✓ facts_cross_referenced

--- evidence ---
2 passed, 0 failed, 1 not run, 0 unverified, 0 timeout
  ✓ bun test (1.2s)
  ✓ bun run typecheck (3.0s)
  ○ bun run lint — not configured

--- verdict: pass-good ---
Looks solid.

duration: 20.8s  rounds: 1

--- cost (bytes proxy, USD est. only) ---
5000 bytes in / 3000 bytes out over 2 spawns (~$0.0450 est.)

--- next action ---
All checks passed. No action needed.
```

### Example: failing report

```text
=== Verification Report ===
run: 43  generated: 2026-09-08T12:05:00Z

--- git facts ---
branch: fix/auth
files changed: 1
lines changed: 15
commits: x1y2z3

--- handoff conformance ---
4/6 passed (needs human review)
  ✓ has_handoff_block
  ✓ claimed_matches_commits
  ✗ uncertain_not_empty — executor flagged uncertainty about token refresh
  ✗ not_done_not_empty — executor reported incomplete: integration tests
  ✓ checks_declared
  ✓ facts_cross_referenced

--- evidence ---
1 passed, 1 failed, 0 not run, 0 unverified, 0 timeout
  ✓ bun run typecheck (2.1s)
  ✗ bun test (0.8s) — 3 tests failed

--- verdict: fail ---
Needs integration tests and resolve uncertainty.

duration: 12.3s  rounds: 1

--- next action ---
Fix failing evidence commands, then re-run verification.
```

### Example: standalone mode (no fapony run)

```text
=== Verification Report ===
run: (none)  generated: 2026-09-08T12:10:00Z

--- git facts ---
branch: main
files changed: 0
lines changed: 0
commits: (none)

--- evidence ---
0 passed, 0 failed, 0 not run, 3 unverified, 0 timeout
  ? bun test — unverified (agent claim)
  ? bun run typecheck — unverified (agent claim)
  ? cargo test — unverified (agent claim)

--- verdict: (not yet) ---

duration: —  rounds: 0

--- next action ---
Submit a verdict to complete verification.
```
