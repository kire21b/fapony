# fapony

fapony turns any coding agent into a multi-agent workflow. You write the plan; fapony drives the execute → review → fix loop: one agent writes code and commits, a second agent reviews the diff, and a fix round runs only if the review fails. Plan, spec, and memory live as plain files in your own git repo, so you can swap agents at any time without migrating anything.

Whether you use Claude Code, OpenCode, Codex, or anything else that reads stdin — no framework to learn: if you can write a markdown plan and run a CLI command, you can use fapony.

## Quick start

```bash
# 1. Install (Bun is the only runtime dependency — fapony itself has zero packages)
git clone https://github.com/kire21b/fapony.git && cd fapony
bun install
bun link            # puts `fapony` on your PATH; or run via `bun fapony.ts`

# 2. Run the interactive wizard (creates config + scaffolds .fapony/ in one step)
fapony setup

# 3. Write a plan — use the template, or draft one with your agent
cp templates/PLAN.md /path/to/your-worktree/.fapony/plan/PLAN-my-feature.md

# 4. Run
fapony kickoff <worktree-key>     # auto-detects the single pending plan
fapony ps                         # what's running + pending plans (when inside a worktree)
fapony gate <run-id> pass         # or: fail "missing error handling on X"
fapony stats                      # pass/stall rate, avg rounds, timing KPIs
```

### Manual setup (alternative)

If you prefer to configure by hand instead of the wizard:

```bash
fapony init /path/to/your-worktree       # scaffold .fapony/ only
cp fapony.config.example.json fapony.config.json  # then edit to match your setup
```

After a run you get a **handoff**: verifiable git facts first (files, lines, commits, branch), then the executor's own report (what it was unsure about, what it didn't finish). You — or a review agent — judge from that, not from a chat transcript.

## How the loop works

```
PLAN (you + your agent)
  │
  ▼
fapony run <worktree> --plan <path>
  │
  ├─ git guard (dirty tree? dangerous command? → stop, ask, never clean up)
  ├─ memory claim (optional, per-project memory via config.memory.*)
  ├─ spawn executor (your agent — Claude Code / OpenCode / Codex / …)
  │    └─ executor writes code, commits, outputs ## HANDOFF
  ├─ gitFacts — real diff stats from git
  ├─ route — big diff (>15 files or >400 lines) → full review, small → normal
  └─ print handoff + review command
        │
        ▼
  review gate (a reviewer agent, or you)
        │
        ├─ pass → done
        └─ fix needed → fapony run <run-id> --loop (round +1, cap 2)
             │
             └─ round 3? → STOP. The plan has a problem, not the code.
```

Small diffs get a cheap pre-pass (`scrutinize-fix` prompt: review + fix in one round) *before* the expensive review gate — small bugs die young instead of burning tokens at the gate.

## Three ways to use it

### Case 1 — Claude Code user who wants a reviewer

You already work in Claude Code. You want a second opinion on every diff before it lands, and you want the loop to chunk a big feature into reviewable pieces.

```jsonc
// fapony.config.json
{
  "worktrees": { "myapp": "/absolute/path/to/myapp" },
  "executor": { "cmd": ["claude", "-p", "--dangerously-skip-permissions"], "timeoutMin": 45 },
  "review": {
    "bigDiff": { "files": 15, "lines": 400 },
    "maxRounds": 2,
    "gate": ["claude", "-p", "/code-review high"]
  }
}
```

```bash
fapony run myapp --plan .fapony/plan/PLAN-my-feature.md
# …review the printed handoff…
fapony gate <run-id> pass        # or fail + note; the note is carried into the fix round
```

The gate note from a `fail` is injected into the next executor round as `{{FEEDBACK}}` — the fixer sees exactly what the reviewer saw.

### Case 2 — OpenCode user who wants project memory

You use OpenCode (`opencode run` reads a prompt from stdin). You want each run to claim a memory slot in the project, log what happened, and get a "what's next" kickoff when work passes review.

```jsonc
// fapony.config.json — memory via shell adapter, agent-agnostic by design
{
  "worktrees": { "myapp": "/absolute/path/to/myapp" },
  "executor": { "cmd": ["opencode", "run"], "timeoutMin": 45 },
  "memory": {
    "claim":   ["bun", ".fapony/.memory/mem.ts", "claim", "{id}"],
    "close":   ["bun", ".fapony/.memory/mem.ts", "close", "{id}", "{msg}"],
    "add":     ["bun", ".fapony/.memory/mem.ts", "add", "{kind}", "{text}"],
    "kickoff": ["bun", ".fapony/.memory/mem.ts", "kickoff"]
  }
}
```

If `.fapony/.memory/mem.ts` exists (scaffolded by `fapony init`, from [templates/memory/](templates/memory/)) you can omit the whole `memory` block — fapony wires these defaults automatically. Memory is **per project**: the adapter runs inside each worktree against that worktree's own `.fapony/.memory/`, while fapony's run-state DB stays outside the worktree where agents can't rewrite it. A memory log that grows past a threshold can be compacted with `bun .fapony/.memory/mem.ts rotate --apply`.

### Case 3 — Codex user who wants spec-driven work

You use Codex (or any agent that takes a prompt on stdin). You keep the detailed contract in a spec file and want it attached to every executor round, so the agent works against a fixed contract instead of re-deriving one.

Point `executor.cmd` at your Codex invocation (flags vary by Codex version — this case is supported by design and verified by fapony's test suite for the spec-injection behavior, not yet run against a live Codex session):

```jsonc
// fapony.config.json
{
  "worktrees": { "myapp": "/absolute/path/to/myapp" },
  "executor": { "cmd": ["codex", "exec"], "timeoutMin": 45 }
}
```

Then reference the spec from the plan header:

```markdown
# PLAN-my-feature
> **Source spec:** .fapony/spec/my-feature.md
```

fapony reads `.fapony/spec/my-feature.md` inside the worktree and appends it to the executor prompt (truncated at `spec.maxLines`, default 200). Missing spec file → `(no spec)`, never a crash.

## Why handoff must be a template with git facts first

The `## HANDOFF` block the executor outputs is a **template**, not a chat transcript. Git facts (files changed, commits, branch) come first because they are verifiable. The executor's self-reported items (uncertain, not_done) come second and are labeled as such. "Typecheck passed" only proves the code compiles — not that the flow or permissions are right. The template forces a structured summary a reviewer can actually consume, and `fapony handoff <run-id>` reprints it later from the audit trail.

## Why cap at 2 rounds

Round 1: executor writes code, reviewer checks it. Round 2: executor fixes what the reviewer found. Round 3 means the **plan** has a problem, not the code — stop and go back to the human. More rounds just burn tokens fixing symptoms; fapony stops the run and says so.

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
cat prompts/plan-with-me.md | claude -p     # Claude Code
cat prompts/plan-with-me.md | opencode run  # OpenCode
cat prompts/plan-with-me.md | <your-agent>  # anything that reads stdin
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

## CLI

```bash
fapony setup                            # interactive wizard (config + scaffold)
fapony init <path>                       # scaffold .fapony/ into a worktree
fapony run <key> --plan <path> [--mem-id <id>] [--allow-dirty] [--loop]
                                         # inside a worktree: key optional; pending single plan → --plan optional
                                         # `fapony run 2` = plan #2 from ps · `fapony run PLAN-al` = name prefix
                                         # `fapony run <run-id>` = resume run (single round)
                                         # `fapony run <run-id> --loop` = resume + loop until done
fapony kickoff <key>                     # auto-detect the single pending plan (key optional inside a worktree)
fapony ps | status                       # active runs + pending plans (plans when inside a worktree)
fapony stats                             # pass/stall rate, avg rounds, exec/review timing
fapony handoff <run-id>                  # reprint a run's handoff
fapony gate <run-id> pass|fail [note]    # review verdict (note: or pipe via stdin)
fapony stop <run-id> [reason]            # stop run + release memory claim
fapony plan-mv <file>                    # archive a shipped PLAN
fapony init-mem <key>                    # scaffold .fapony/.memory/ only (legacy path)
fapony telemetry show|send               # opt-in only, default off — see TELEMETRY.md
fapony test                              # self-check
```

## Config

`fapony.config.json` lives in the fapony checkout and is gitignored (it's per-machine). Copy [fapony.config.example.json](fapony.config.example.json) to get a complete working reference; every section is optional with sane defaults. Key fields:

- `worktrees` — name → absolute path mapping
- `executor.cmd` — command to spawn (receives the prompt via stdin); `roles.executor` overrides it per-role with `{model}` support
- `review.bigDiff` / `review.maxRounds` / `review.gate` — routing, round cap, reviewer command
- `memory` — shell commands for claim/close/add/kickoff, or `null` to default-wire when `.fapony/.memory/mem.ts` exists
- `prompts` / `markers` / `paths` / `safety` — override prompt files, output markers, directory layout, and the dangerous-command deny-list
- `pricing` — optional per-role USD/1k-token rates; every spawn logs role/model + byte in/out regardless, `pricing` only adds a labeled `usd_estimate` (see [TELEMETRY.md](TELEMETRY.md))

Env overrides: `FAPONY_CONFIG` (config file), `FAPONY_STATE_DIR` (state DB location; default `~/.config/fapony/`). Full schema, design decisions, and edge cases are documented in [CLAUDE.md](CLAUDE.md) — this README intentionally doesn't duplicate them.

## Scope

**Supported:**
- Bun-only, zero runtime dependency (`bun:sqlite` for run state, WAL mode)
- Git worktree coordination (guard, handoff, routing, auto-archive on ship)
- Memory integration via shell adapter, per project (configurable or default-wired)
- Vendor-neutral executor/reviewer roles — anything that reads stdin
- Opt-in telemetry, off by default ([TELEMETRY.md](TELEMETRY.md) lists exactly what leaves the machine)

**Not supported (yet):**
- DeepSeek prefilter (a slot exists in config; the code path is not wired)
- Distributed runs across multiple machines
- Memory migration from `.fapony/.memory/log.jsonl`

## License

MIT
