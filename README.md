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

## Skills

fapony ships with three portable skills (copy to any agent tool):

| Skill | Purpose | Trigger |
|-------|---------|---------|
| `skill/git-commit-conventional.md` | Commit split by concern + conventional message | `/git-commit` |
| `skill/move-to-done.md` | Archive PLAN to .fapony/plan/done/ after ship | `/move-to-done` |
| `skill/plan-with-me.md` | Draft plan + spec from "what's in your head" via conversation | `/plan-with-me` |

## Using plan-with-me with any agent

The `plan-with-me` prompt is vendor-neutral — pipe it to any agent:

```bash
# opencode
cat prompts/plan-with-me.md | opencode run

# Claude Code
cat prompts/plan-with-me.md | claude -p

# Any agent that reads stdin
cat prompts/plan-with-me.md | <your-agent>
```

**Example plans** produced by this prompt (in [examples/](examples/)):

| Plan | Type | Scope |
|------|------|-------|
| [PLAN-webapp-notifications.md](examples/PLAN-webapp-notifications.md) | Web app | Spec-heavy, wide (WebSocket + UI + backend) |
| [PLAN-cli-logger.md](examples/PLAN-cli-logger.md) | CLI tool | Small, no spec |
| [PLAN-refactor-auth.md](examples/PLAN-refactor-auth.md) | Refactor | Existing code, no new feature |
| [PLAN-fix-race-condition.md](examples/PLAN-fix-race-condition.md) | Bug fix | Small, specific |
| [PLAN-feature-export.md](examples/PLAN-feature-export.md) | New feature | Medium scope |

## Prompts

| Prompt | Used by | Purpose |
|--------|---------|---------|
| `prompts/execute.md` | executor | What to build, rules, output contract |
| `prompts/fixer.md` | fixer | Fix gate review notes + re-handoff |
| `prompts/planner.md` | planner | Update PLAN, mark shipped, hand off next chunk |
| `prompts/scrutinize-fix.md` | review agent | Two-phase review + fix in one round |
| `prompts/plan-with-me.md` | any agent | Draft plan + spec from conversation (vendor-neutral) |

## Scope

**Supported:**
- Bun-only, zero runtime dependency
- SQLite via `bun:sqlite` for run state
- Git worktree coordination (guard, handoff, routing)
- Memory integration via shell commands (configurable)
- Memory log rotation (`bun .fapony/.memory/mem.ts rotate --apply`) once `log.jsonl` crosses a row threshold — archives resolved rows via `git mv`, keeps open work + unresolved decisions/notes
- Manual review gate (chunk 1 — you run the review command yourself)

**Not supported (yet):**
- Auto-driving the executor via `claude -p` or `opencode run` (chunk 2)
- DeepSeek prefilter
- Distributed runs across multiple machines
- Memory migration from `.fapony/.memory/log.jsonl`

## Usage

```bash
# First run
fapony run vela --plan .fapony/plan/PLAN-foo.md --mem-id abc123

# Check active runs
fapony status

# KPIs across all runs — pass/stall rate, avg rounds, exec/review time
fapony stats

# Print (or send, if configured) telemetry — see TELEMETRY.md for exactly what's in it
fapony telemetry show
fapony telemetry send

# Reprint handoff for a run
fapony handoff <run-id>

# Close the review gate — pass closes the mem claim + prints mem kickoff (next items)
fapony gate <run-id> pass "reviewed, looks good"
fapony gate <run-id> fail "missing error handling on X" # round+1, status → fixing

# Stop a run
fapony stop <run-id> "plan needs rework"

# Scaffold the .fapony/.memory/ system (mem.ts + store/selectors/render/commands) into a
# new worktree from templates/memory/ — for projects that don't have one yet
fapony init-mem <worktree-key>

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
