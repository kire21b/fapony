# fapony

fapony measures what coding agents actually do — tokens, cost, rounds, pass/fail, per model and per workflow — through 6 MCP tools that any agent can call (Claude Code, OpenCode, Codex, anything that speaks MCP). If you juggle more than one agent, this is the point: the numbers come from the same yardstick everywhere, so "which model earns its keep on which kind of task" becomes a data question instead of a vibe. On top of measurement, fapony verifies claims: git facts first, handoff conformance, allowlisted evidence, a 6-grade verdict — with everything the agent claimed but couldn't prove marked as such.

Two tiers, deliberately: **measurement ships today** and needs no per-project setup — raw facts nobody can call unfair. **Verification is the sharper edge** but stays beta until its evidence layer is hardened; fapony doesn't control your agent's flow, so it never promises "verified" as a headline.

Adopting it doesn't change your workflow. There is no loop to join and no framework to learn: install the MCP server, point your agent at it, and read the reports.

## Quick start (MCP)

```bash
# 1. Install (Bun is the only runtime dependency — fapony itself has zero packages)
git clone https://github.com/kire21b/fapony.git && cd fapony
bun install
bun link            # puts `fapony` on your PATH; or run via `bun fapony.ts`

# 2. Wire it into your MCP client
fapony install --platform opencode        # adds mcp.fapony to your opencode config
fapony install --platform claude          # adds fapony to Claude Code (user scope, via `claude mcp add`)
# …or add it manually to any MCP client (e.g. Claude Desktop):
# { "mcpServers": { "fapony": { "command": "fapony", "args": ["mcp"] } } }

# 3. Measure — zero per-project setup
#    ask your agent: "Run fapony_stats and fapony_usage — what has it cost me, per model?"

# 4. Verify (optional, per project) — scaffold the evidence allowlist
fapony init /path/to/your-worktree
#    .fapony/evidence.json lists the commands the evidence collector may run —
#    edit the placeholder cmds to your real test/typecheck commands
```

With `.fapony/evidence.json` in place, ask your agent to verify its own work:

```
"Run fapony verification_report on this repo and summarize the result."
```

You get one report: git facts (files, commits, branch), handoff conformance (claims vs. reality), evidence from the allowlisted commands (pass/fail/timeout/unverified), a 6-grade verdict, and cost — with anything the agent claimed but couldn't prove marked as such.

## The 6 tools

```
measure:  handoff_collect ── fapony_stats ── fapony_usage
verify:   handoff_check ── verdict_submit ── verification_report
          (facts + checks + evidence + verdict + cost, in one call)
```

| Tool | Tier | Purpose |
|------|------|---------|
| `handoff_collect` | measure | Machine facts from git (diff stat, commits, branch) |
| `fapony_stats` | measure | KPIs across runs: by-model, by-grade, by-value |
| `fapony_usage` | measure | Passive usage from OpenCode sessions (tokens, cost, by-model) — other agents' session logs aren't wired in yet |
| `handoff_check` | verify | Check the agent's handoff claims against those facts |
| `verdict_submit` | verify | Store a 6-grade verdict (pass-excellent → uncertain) |
| `verification_report` | verify | Full report: facts + checks + evidence + verdict + cost |

Prefer CLI? `fapony report <run-id>` prints the same report for a run; `fapony report-web [file]` renders it as a static HTML page.

Full protocol, adapter examples (bash, Python), and safety rules: [docs/mcp-handcheck.md](docs/mcp-handcheck.md).

## Why measure from the outside

- **Raw facts are hard to argue with.** Cost, rounds, diff sizes, pass rates — collected from git and session logs, not self-reported. A vendor can dispute a verdict as unfair; they can't dispute their own token count.
- **Agent platforms grading their own homework is a conflict of interest.** fapony is a separate layer that measures any agent the same way, which is what makes "model X vs. model Y" or "workflow A vs. workflow B" answerable with real data instead of vibes.
- **Verification stays honest about its limits.** The collector runs only commands listed in `.fapony/evidence.json`; commands proposed by the agent outside the allowlist are reported as *proposed — not executed*, never run. And because fapony doesn't control your agent's flow, verdicts are labeled as one signal — not promised as truth.

## Verdict grades

Verification produces a quality grade, not just pass/fail:

| Grade | Meaning |
|-------|---------|
| `pass-excellent` | Ship-quality, no issues |
| `pass-good` | Minor nits, safe to ship |
| `pass-adequate` | Works, but could be better |
| `pass` | Meets minimum bar |
| `fail` | Needs fixes |
| `uncertain` | Reviewer can't judge — plan may have a problem |

## Skills

fapony ships with three portable skills (copy to any agent tool):

| Skill | Purpose | Trigger |
|-------|---------|---------|
| `skill/git-commit-conventional.md` | Commit split by concern + conventional message | `/git-commit` |
| `skill/move-to-done.md` | Archive PLAN to .fapony/plan/done/ after ship | `/move-to-done` |
| `skill/plan-with-me.md` | Draft plan + spec from "what's in your head" via conversation | `/plan-with-me` |

`plan-with-me` is vendor-neutral — pipe it to any agent:

```bash
cat prompts/plan-with-me.md | claude -p     # Claude Code
cat prompts/plan-with-me.md | opencode run  # OpenCode
cat prompts/plan-with-me.md | <your-agent>  # anything that reads stdin
```

Example plans produced by it live in [examples/](examples/).

## CLI

```bash
# Verification & reporting
fapony mcp                               # MCP server (stdio JSON-RPC — 6 tools)
fapony report <run-id>                   # verification report for a run
fapony report-web [file]                 # static HTML report page
fapony stats                             # KPIs: pass/stall rate, by-model, by-grade
fapony handoff <run-id>                  # reprint a run's handoff
fapony gate <run-id> <grade> [note]      # review verdict (6 grades)

# Setup & maintenance
fapony init <path>                       # scaffold .fapony/ (plan/spec/memory/evidence)
fapony install --platform opencode       # add mcp.fapony to opencode config
fapony install --platform claude         # add fapony to Claude Code (user scope)
fapony setup                             # interactive wizard: config + scaffold in one step
fapony update                            # self-update via git pull
fapony telemetry show|send               # opt-in only, default off — see TELEMETRY.md
fapony test                              # self-check
```

## Config

`fapony.config.json` lives in the fapony checkout and is gitignored (it's per-machine). Copy [fapony.config.example.json](fapony.config.example.json) for a complete working reference; every section is optional with sane defaults. Key fields:

- `worktrees` — name → absolute path mapping
- `roles.<name>.model` — model attribution per role (used for cost/KPI breakdowns; nothing spawns agents — the CLI loop is gone, measurement is via MCP)
- `review.maxRounds` — round cap enforced by the gate
- `memory` — shell commands for claim/close/add/kickoff, or `null` to default-wire when `.fapony/.memory/mem.ts` exists
- `paths` (`planDir`/`specDir`/`memoryEntry`/`stateDir`) / `safety` — directory layout and the dangerous-command deny-list
- `pricing` — optional per-role USD/1k-token rates; every spawn logs role/model + byte in/out regardless, `pricing` only adds a labeled `usd_estimate` (see [TELEMETRY.md](TELEMETRY.md))

Env overrides: `FAPONY_CONFIG` (config file), `FAPONY_STATE_DIR` (state DB location; default `~/.config/fapony/`). Full schema, design decisions, and edge cases are documented in [CLAUDE.md](CLAUDE.md) — this README intentionally doesn't duplicate them.

## Scope

**Supported:**
- MCP server — 6 tools via stdio JSON-RPC, works with any MCP client
- Measurement: cross-run KPIs by model/grade/value + passive usage (tokens, cost)
- Verification (beta): handoff conformance, 6-grade verdicts, allowlisted evidence collector (`.fapony/evidence.json` — agent-proposed commands are never executed)
- Vendor-neutral executor/reviewer roles — anything that reads stdin
- Memory integration via shell adapter, per project (configurable or default-wired)
- Opt-in telemetry, off by default ([TELEMETRY.md](TELEMETRY.md) lists exactly what leaves the machine)
- Bun-only, zero runtime dependency (`bun:sqlite` for run state, WAL mode)

**Not supported (yet):**
- Cross-agent usage — `fapony_usage` reads OpenCode's session DB only; Claude Code and other agents keep their own session logs, not wired in
- DeepSeek prefilter (not wired; no config slot — the loop-era `review.prefilter` key was removed)
- Distributed runs across multiple machines
- Memory migration from `.fapony/.memory/log.jsonl`

## License

MIT
