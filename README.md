<p align="center">
  <img src="images/logo@400.webp" width="400" alt="fapony logo">
</p>

# fapony

fapony measures what coding agents actually do — tokens, cost, rounds, pass/fail, per model and per workflow — through 8 MCP tools that any agent can call (Claude Code, OpenCode, Codex, anything that speaks MCP). If you juggle more than one agent, this is the point: the numbers come from the same yardstick everywhere, so "which model earns its keep on which kind of task" becomes a data question instead of a vibe. On top of measurement, fapony verifies claims: git facts first, handoff conformance, allowlisted evidence, a 6-grade verdict — with everything the agent claimed but couldn't prove marked as such.

**The reason to keep it running is the third layer: knowledge accumulation.** Any single client already logs its own session — timing, tokens, tool calls. What none of them see is *across* runs, clients, and rounds: which failure reason keeps coming back on this project, which plans blew the round cap (a plan problem, not a code problem — see [CLAUDE.md](CLAUDE.md) Key Design Decision #2), which shapes passed clean on round one. fapony is the only thing positioned to see that, because it's the one layer every client reports into. That history feeds straight back into `plan-with-pony` as a short "known patterns" block — so a dev benefits from their own project's track record without ever opening a stats dashboard.

Three tiers, deliberately: **measurement ships today** and needs no per-project setup — raw facts nobody can call unfair. **Verification is the sharper edge** but stays beta until its evidence layer is hardened; fapony doesn't control your agent's flow, so it never promises "verified" as a headline. **Knowledge accumulation is the compounding one** — it's worthless on run 1 and gets more useful every run after, which is exactly why it's the layer competitors can't clone by copying a feature list.

Adopting it doesn't change your workflow. There is no loop to join and no framework to learn: install the MCP server, point your agent at it, and read the reports.

<p align="center">
  <img src="images/summary.webp" width="800" alt="fapony usage-web summary cards">
</p>

<details>
<summary>full usage-web dashboard preview</summary>

<p align="center">
  <img src="images/sample.webp" width="800" alt="fapony usage-web dashboard">
</p>

</details>

## Quick start (MCP)

```bash
# 1. Install (Bun is the only runtime dependency — fapony itself has zero packages)
git clone https://github.com/kire21b/fapony.git && cd fapony
bun install
bun link            # puts `fapony` on your PATH; or run via `bun fapony.ts`

# 2. Wire it into your MCP client
fapony install --platform opencode        # adds mcp.fapony to your opencode config
fapony install --platform claude          # adds fapony to Claude Code (user scope, via `claude mcp add`)
fapony install --platform zcode           # adds fapony to ZCode (user scope, edits ~/.zcode/cli/config.json)
fapony install --platform codex           # adds fapony to Codex (edits ~/.codex/config.toml)
#    claude/opencode also symlink skill/<name>/ into ~/.claude/skills — an existing
#    skill of the same name is reported, never overwritten
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

Sections that have nothing to report say so (`not_run`, `unavailable`) rather than disappearing — a report with no evidence must not read like a report that passed.

Two things worth knowing about the report header and budget:

- **`server_sha`** — every report is stamped with the git SHA of the fapony code that produced it, read once at server start. MCP servers are long-lived: after you edit fapony and don't restart the client, reports keep coming from the old build. Compare the stamp against `git log -1` in the fapony repo; if they differ, reconnect the server before trusting the result.
- **Evidence budget** — each allowlisted command gets `timeout_ms` (default 30s), and the whole report is capped at 180s total. A command that doesn't fit is reported as `timeout`, never as a pass. Time your real suite and set `timeout_ms` accordingly.

## How it fits

```mermaid
flowchart LR
    A[Claude Code] --> F[fapony MCP]
    B[OpenCode] --> F
    C[ZCode] --> F
    D[Codex] --> F
    F --> G[git facts + session logs]
    G --> S[stats / usage]
    G --> V[verification report]
    G --> P[project_health → plan-with-pony]
```

fapony never drives the agent — it is a set of checkpoints the agent walks past. One
work cycle looks like this:

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent (any MCP client)
    participant F as fapony MCP
    participant W as your worktree

    A->>F: plan_list
    F-->>A: pending plans + how each one went last time
    Note over A,W: agent does the actual work — fapony is not involved
    A->>F: verification_report
    F->>W: git diff/log + commands from .fapony/evidence.json
    W-->>F: facts + evidence (passed / failed / timeout / not_run)
    F-->>A: one report, stamped with server_sha
    A->>F: verdict_submit (grade + reason_code + note)
    Note over F: stored in ~/.config/fapony/state.db
    F-->>A: project_health_context — past notes shape the next plan
```

`verdict_submit` is the only step that creates knowledge, and `project_health_context`
is the only reason to keep it. Everything in between is the agent's own business.

## The 8 tools

```
discover: plan_list (pending plan files joined with their run history)
measure:  handoff_collect ── fapony_stats ── fapony_usage
verify:   handoff_check ── verdict_submit ── verification_report
plan:     project_health_context (known patterns from history → plan-with-pony)
          (facts + checks + evidence + verdict + cost, in one call)
```

| Tool | Tier | Purpose |
|------|------|---------|
| `plan_list` | discover | Pending `.fapony/plan/*.md` files joined with run history (title, run count, last verdict) — not a raw `ls` |
| `handoff_collect` | measure | Machine facts from git (diff stat, commits, branch) |
| `fapony_stats` | measure | KPIs across runs: by-model, by-grade, by-value; `group_by: reason_code\|plan` for top-N slices |
| `fapony_usage` | measure | Passive usage from OpenCode, ZCode, Claude Code, and Codex sessions (tokens, cost, by-model; `detail:true` adds per-step timing) |
| `handoff_check` | verify | Check the agent's handoff claims against those facts |
| `verdict_submit` | verify | Store a 6-grade verdict (pass-excellent → uncertain) |
| `verification_report` | verify | Full report: facts + checks + evidence + verdict + cost |
| `project_health_context` | plan | Known-patterns block for plan-with-pony: recurring fail reasons, escalated runs, round-1-pass shapes |

Prefer CLI? `fapony report <run-id>` prints the same report for a run; `fapony report-web [file]` renders it as a static HTML page. `fapony usage-web [port]` starts a live comparison dashboard across OpenCode, ZCode, Claude Code, and Codex sessions — by default it samples (OpenCode/ZCode timing: last 20k parts; Claude Code/Codex: last 30 days, skipped by file mtime so old JSONL history is never read) instead of scanning everything; pass `--full` for an exact all-time scan. The dashboard title shows which mode is active.

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

fapony ships five portable skills, each as `skill/<name>/SKILL.md` — the layout Claude
Code expects, so a client can symlink the directory rather than copy the file:

| Skill | Purpose | Trigger |
|-------|---------|---------|
| `skill/plan-with-pony/` | Draft plan + spec from "what's in your head" via conversation | `/plan-with-pony` |
| `skill/review-pony/` | Review as verification, wired to fapony: known patterns before, verdict after | `/review-pony` |
| `skill/move-to-done/` | Archive PLAN to .fapony/plan/done/ after ship | `/move-to-done` |
| `skill/git-commit-conventional/` | Commit split by concern + conventional message | `/git-commit` |
| `skill/git-ship/` | Push branch, open PR with drafted title/body, merge, reset branch onto base | `/ship`, `/pr` |

### When to call what

```mermaid
flowchart TD
    I([idea]) --> P["/plan-with-pony"]
    P --> W[you and your agent build]
    W --> C["/git-commit"]
    C --> R["/review-pony"]
    R -->|findings| W
    R -->|clean| S["/git-ship"]
    S --> D["/move-to-done"]
    D -.-> H[(fapony history)]
    R -.-> H
    H -.->|known patterns| P

    style H fill:#2d333b,stroke:#768390,color:#adbac7
```

The dotted edges are the whole point. `/review-pony` and `/move-to-done` write a verdict with a
`reason_code` and a one-line note; `/plan-with-pony` reads them back before the next plan is
written. Nothing else in the loop knows what went wrong last month.

| Moment | Call | What fapony gets out of it |
|---|---|---|
| Before writing a plan | `/plan-with-pony` | reads `project_health_context` — what keeps failing here |
| Before committing | `/git-commit` | nothing; it just keeps commits reviewable |
| Before merging | `/review-pony` | writes a verdict + `reason_code` + note |
| Merging | `/git-ship` (`pr` / `land` on a team) | nothing; pure git plumbing |
| After it ships | `/move-to-done` | writes the ship verdict, closes the loop |
| Any time | ask for `verification_report` | git facts + allowlisted evidence, one call |

**Team flow.** `/git-ship pr` stops once the PR is open and hands you the URL; the reviewer does
their pass; `/git-ship land` merges it after approval. If the default branch requires reviews,
plain `/git-ship` detects that and behaves like `pr` on its own.

**What this is not.** It doesn't reduce your token bill — an agent that plans against known
failure patterns tends to spend fewer rounds getting there, but fapony measures that, it doesn't
cause it. Use `fapony_usage` to find out whether it actually happened for you rather than taking
the claim on faith.

`fapony install --platform claude` (or `opencode`) symlinks these directories into
`~/.claude/skills` rather than copying them, so `fapony update` refreshes every client
at once. A destination that already exists and isn't a fapony link is reported and left
alone — replace it by hand if you want fapony's version.

`plan-with-pony` is vendor-neutral — the SKILL.md *is* the prompt, so pipe it to any agent:

```bash
cat skill/plan-with-pony/SKILL.md | claude -p     # Claude Code
cat skill/plan-with-pony/SKILL.md | opencode run  # OpenCode
cat skill/plan-with-pony/SKILL.md | <your-agent>  # anything that reads stdin
```

Example plans produced by it live in [examples/](examples/).

## CLI

```bash
# Verification & reporting
fapony mcp                               # MCP server (stdio JSON-RPC — 8 tools)
fapony report <run-id>                   # verification report for a run
fapony report-web [file]                 # static HTML report page
fapony usage-web [port] [--full]         # live usage comparison dashboard (OpenCode / ZCode / Claude Code / Codex) — default samples (last 30d + last 20k parts), --full for an exact all-time scan
fapony stats                             # KPIs: pass/stall rate, by-model, by-grade

# Setup & maintenance
fapony init <path>                       # scaffold .fapony/ (plan/spec/memory/evidence)
fapony install --platform opencode       # add mcp.fapony to opencode config
fapony install --platform claude         # add fapony to Claude Code (user scope)
fapony install --platform zcode          # add fapony to ZCode (user scope)
fapony install --platform codex          # add fapony to Codex (edits ~/.codex/config.toml)
fapony setup                             # interactive wizard: config + scaffold in one step
fapony update                            # self-update via git pull
fapony telemetry show|send               # opt-in only, default off — see TELEMETRY.md
fapony test                              # self-check
```

## Config

`fapony.config.json` lives in the fapony checkout and is gitignored (it's per-machine). Copy [fapony.config.example.json](fapony.config.example.json) for a complete working reference; every section is optional with sane defaults. Key fields:

- `worktrees` — name → absolute path mapping
- `roles.<name>.model` — model attribution per role, used for cost/KPI breakdowns (optional, no effect on behavior)
- `review.maxRounds` — round cap enforced by the gate
- `memory` — shell commands for claim/close/add/kickoff, or `null` to default-wire when `.fapony/.memory/mem.ts` exists
- `paths` (`planDir`/`specDir`/`memoryEntry`/`stateDir`) / `safety` — directory layout and the dangerous-command deny-list
- `pricing` — optional per-role USD/1k-token rates; every spawn logs role/model + byte in/out regardless, `pricing` only adds a labeled `usd_estimate` (see [TELEMETRY.md](TELEMETRY.md))
- `usageWeb` — optional `{ port, hostname, pollInterval }` for `fapony usage-web` server defaults (CLI args override)

Env overrides: `FAPONY_CONFIG` (config file), `FAPONY_STATE_DIR` (state DB location; default `~/.config/fapony/`). Full schema, design decisions, and edge cases are documented in [CLAUDE.md](CLAUDE.md) — this README intentionally doesn't duplicate them.

## Scope

**Supported:**
- MCP server — 8 tools via stdio JSON-RPC, works with any MCP client
- Measurement: cross-run KPIs by model/grade/value + passive usage (tokens, cost)
- Verification (beta): handoff conformance, 6-grade verdicts, allowlisted evidence collector (`.fapony/evidence.json` — agent-proposed commands are never executed); reports stamped with the producing build's `server_sha`
- Vendor-neutral executor/reviewer roles — anything that reads stdin
- Memory integration via shell adapter, per project (configurable or default-wired)
- Opt-in telemetry, off by default ([TELEMETRY.md](TELEMETRY.md) lists exactly what leaves the machine)
- Bun-only, zero runtime dependency (`bun:sqlite` for run state, WAL mode)

**Not supported (yet):**
- DeepSeek prefilter (not wired; no config slot — the loop-era `review.prefilter` key was removed)
- Distributed runs across multiple machines
- Memory migration from `.fapony/.memory/log.jsonl`

## License

MIT
