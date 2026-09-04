# fapony

Multi-agent dev loop orchestrator. You plan, fapony coordinates the execute → review → fix cycle.

```
PLAN (you + Claude)
  │
  ▼
fapony run <worktree> --plan <path>
  │
  ├─ git guard (dirty tree? dangerous command?)
  ├─ memory claim (optional, via config.memory.*)
  ├─ spawn executor (opencode / claude code / etc.)
  │    └─ executor writes code, commits, outputs ## HANDOFF
  ├─ gitFacts() — real diff stats from git
  ├─ route — big diff (>15 files or >400 lines) → full review, small → normal
  └─ print handoff + review command
        │
        ▼
  review gate (claude -p /code-review high)
        │
        ├─ pass → fapony status shows passed
        └─ fix needed → fapony run again (round +1, cap 2)
             │
             └─ round 3? → STOP. Plan has a problem, not code.
```

## Why handoff must be a template with git facts first

The `## HANDOFF` block that the executor outputs is a **template**, not a chat transcript. Git facts (files changed, commits, branch) come first because they are verifiable. The executor's self-reported items (uncertain, not_done) come second and are labeled as such.

A chat transcript is too long for a reviewer to read completely, and "typecheck passed" is only proof that the code compiles — not that the flow or permissions are correct. The handoff template forces the executor to produce a structured summary that the reviewer can actually consume.

## Why cap at 2 rounds

Round 1: executor writes code, reviewer checks it.
Round 2: executor fixes what the reviewer found.
Round 3 means the **plan** has a problem, not the code. At that point, stop and go back to the human who wrote the plan. More rounds just burn tokens fixing symptoms.

## Scope

**Supported:**
- Bun-only, zero runtime dependency
- SQLite via `bun:sqlite` for run state
- Git worktree coordination (guard, handoff, routing)
- Memory integration via shell commands (configurable)
- Manual review gate (chunk 1 — you run the review command yourself)

**Not supported (yet):**
- Auto-driving the executor via `claude -p` or `opencode run` (chunk 2)
- DeepSeek prefilter
- Distributed runs across multiple machines
- Memory migration from `.memory/log.jsonl`

## Usage

```bash
# First run
fapony run vela --plan PLAN-foo.md --mem-id abc123

# Check active runs
fapony status

# Reprint handoff for a run
fapony handoff <run-id>

# Close the review gate — pass closes the mem claim + prints mem kickoff (next items)
fapony gate <run-id> pass "reviewed, looks good"
fapony gate <run-id> fail "missing error handling on X" # round+1, status → fixing

# Stop a run
fapony stop <run-id> "plan needs rework"

# Self-test
fapony test
```

## Config

`fapony.config.json` in the project root. See the example file for the full schema.

Key fields:
- `worktrees` — name → path mapping
- `executor.cmd` — command to spawn (receives prompt via stdin)
- `executor.timeoutMin` — kill executor after this many minutes
- `review.bigDiff` — thresholds for routing to "big" review
- `review.maxRounds` — hard cap on fix rounds
- `review.gate` — command to run for review
- `memory` — shell commands for claim/close/add/kickoff, or `null` to disable

## License

MIT
