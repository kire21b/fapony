# fapony — Knowledge Base

## What is fapony

Measurement + verification layer for coding agents, shipped as an MCP server (`fapony mcp` — 6 tools, stdio JSON-RPC). No loop, no spawning, no executor role — fapony doesn't drive agents, it measures what already happened (git facts, session cost/tokens) and verifies claims against those facts. Any agent that speaks MCP can call it. อยู่นอก worktree ของ product เพราะ state ของผู้วัดไม่ควรอยู่ในที่ที่ผู้ถูกวัดแก้ได้

**Runtime:** Bun-only, zero runtime dependency — ใช้แค่ `bun:sqlite`, `node:fs`, `node:child_process`
**State:** SQLite ที่ `~/.config/fapony/state.db` (WAL mode) — `FAPONY_STATE_DIR` env ย้ายได้
**Topology:** `fapony/` = main (คุณแตะคนเดียว) · `fapony/wt-fapony/` = dev (agents ทำงานที่นี่เท่านั้น) — worktree อยู่ใน repo จึงต้อง gitignore `wt-*/` ก่อน
**License:** MIT, public ตั้งแต่ commit แรก

---

## Architecture

```
fapony/
  fapony.ts           # CLI dispatch — init|init-mem|install|mcp|report|report-web|setup|stats|telemetry|test|update
  fapony.config.json  # runtime config (worktrees, roles, review.maxRounds, memory, pricing) — optional, gitignored
  prompts/
    plan-with-me.md   # draft plan + spec from conversation — piped to any agent's stdin
  skill/
    git-commit-conventional.md  # commit แยก concern + conventional message
    move-to-done.md             # archive PLAN หลัง ship
    plan-with-me.md             # draft plan + spec จาก conversation
  templates/
    PLAN.md / SPEC.md / memory/  # plan+spec templates, memory scaffold for `fapony init`
  src/
    db/               # SQLite + config
      store.ts        # openDb + schema/migration (PRAGMA user_version) + CRUD
      load.ts         # loadConfig()
      getters.ts      # getters รวมศูนย์ — ห้าม hardcode ที่ call site
      types.ts        # Config / Row types
      defaults.ts     # DEFAULT_* constants (safety deny list, …)
      index.ts        # re-export
    cost.ts           # beginSpawn/endSpawn — role/model/bytes_in/out/usd_estimate ต่อ spawn event
    gates.ts          # per-round gate enrichment — pairs gate events with spawn events in their round window
    parse.ts          # parseGateVerdict() + qualityScore()
    memory.ts         # shell adapter + resolveMemoryConfig + DEFAULT_MEMORY
    safety.ts         # assertSafe() deny-list (checked before any config-sourced shell cmd runs)
    session/           # passive usage readers — OpenCode (SQLite), ZCode (SQLite), Claude Code (JSONL)
      index.ts         # re-exports (backward compat)
      types.ts         # ModelBreakdown, SessionDetail, UsageDetail, PassiveUsageResult
      helpers.ts       # buildWhereClause(), aggregateDetail(), readDetailFromDb()
      opencode.ts      # readPassiveUsage() — OpenCode session DB
      zcode.ts         # readZcodeUsage() — ZCode session DB
      claude-code.ts   # readClaudeCodeUsage() — Claude Code JSONL files
    math.ts            # minutesBetween(), avg() — shared pure numeric helpers
    init.ts            # fapony init — scaffold .fapony/{plan,spec,.memory,evidence.json}
    init-mem.ts        # init-mem command (legacy, superseded by init)
    stats.ts           # fapony stats — KPI + cost total across runs
    report.ts / report-html.ts  # fapony report / report-web — verification report (CLI mirror of the MCP tool)
    telemetry.ts        # opt-in payload (runs/events/cost allowlist เท่านั้น)
    setup.ts            # fapony setup — interactive wizard: config + scaffold ในขั้นเดียว
    install.ts          # fapony install --platform opencode|claude|zcode — wire the MCP server into a client
    update.ts            # fapony update — self-update via git pull (tripwire test คุม ROOT)
    util.ts               # templateArgs / fillPrompt / isAffirmative
    mcp/                   # MCP server — stdio JSON-RPC, 6 tools
      index.ts             # MCP entry point + tool registration
      transport.ts         # JSON-RPC framing (stdin/stdout)
      evidence.ts          # allowlisted evidence collector (.fapony/evidence.json — never runs agent-proposed cmds)
      types.ts             # MCP type definitions
      tools/
        collect.ts         # handoff_collect — git facts
        check.ts           # handoff_check — conformance
        verdict.ts         # verdict_submit — 6-grade verdict storage
        stats.ts           # fapony_stats — KPI query
        usage.ts           # fapony_usage — passive OpenCode session usage
        report.ts          # verification_report — facts + checks + evidence + verdict + cost, one call
    test.ts               # self-check ตัวเอง (thin wrapper → test/index.ts)
  test/
    *.test.ts              # one file per src module
    mcp/                   # MCP tool tests
```

---

## DB Schema (2 ตารางเท่านั้น ห้ามเพิ่ม)

```sql
runs(
  id INTEGER PRIMARY KEY,
  worktree TEXT NOT NULL,
  plan TEXT,
  mem_id TEXT,
  status TEXT NOT NULL,        -- running|awaiting_review|fixing|passed|stopped|stalled
  base_sha TEXT NOT NULL DEFAULT '',
  round INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)

events(
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL,          -- spawn|gate|stop|memory_claim_closed|verification_report
  data TEXT                    -- json
)
```

**หลักคิด:** events คือ audit trail ที่เป็นข้อเท็จจริง (ไม่ใช่ transcript) — มาแทน "copy chat ทั้งหมด" · `runs` row = 1 measured/verified unit of work ที่ MCP client สร้างผ่าน `handoff_collect`, ไม่ใช่ 1 spawned execution loop

---

## Config Schema

ทุก field optional, `fapony.config.json` เองก็ optional (ไม่มีไฟล์ = ใช้ default ทั้งหมด) — ดู `src/db/types.ts` เป็น source of truth ตรง ๆ:

```json
{
  "worktrees": { "<key>": "<absolute-path>" },
  "roles": { "<role-name>": { "model": "claude-sonnet-5" } },
  "review": { "maxRounds": 2 },
  "memory": {
    "claim": ["bun", ".fapony/.memory/mem.ts", "claim", "{id}"],
    "close": ["bun", ".fapony/.memory/mem.ts", "close", "{id}", "{msg}"],
    "add":   ["bun", ".fapony/.memory/mem.ts", "add", "{kind}", "{text}"],
    "kickoff": ["bun", ".fapony/.memory/mem.ts", "kickoff"]
  },
  "pricing": { "<role>": { "inputPer1k": 3.0, "outputPer1k": 15.0 } },
  "telemetry": { "enabled": false, "endpoint": "https://your-server/ingest" },
  "paths": { "stateDir": "~/.config/fapony", "planDir": ".fapony/plan", "specDir": ".fapony/spec", "memoryEntry": ".fapony/.memory/mem.ts" },
  "safety": { "deny": ["reset\\s+--hard", "clean\\s+-[a-z]*f", "checkout\\s+--\\s", "git\\s+stash"] }
}
```

- `roles.<name>.model` — model attribution only, for cost/KPI breakdowns. Nothing spawns agents; there's no `cmd`/`timeout` to configure anymore.
- `review.maxRounds` — round cap read by the gate/stats logic (see Key Design Decisions #2 below) — the only surviving field of the old `review` block.
- `pricing` — optional, per-role USD per 1k tokens. Every spawn logs `role`/`model` + byte in/out into the `spawn` event regardless; `pricing` (or its absence/`null`) only toggles whether a labeled `usd_estimate` is attached — bytes are a declared proxy, not real token counts, USD is never a real charge (see [TELEMETRY.md](TELEMETRY.md), `src/stats.ts`, `src/telemetry.ts`)
- `telemetry` — opt-in only (omit or `null` = off). ดู [TELEMETRY.md](TELEMETRY.md) ว่าส่งฟิลด์อะไรบ้าง (runs + event kind/timestamp เท่านั้น ไม่มี plan/commit/gate-note content)
- `memory: null` = ปิดทั้งชั้น (แต่ถ้า `.fapony/.memory/mem.ts` มีจริง → default-wiring ใช้ claim/close/add อัตโนมัติ)
- env override: `FAPONY_CONFIG` (เลือกไฟล์ config), `FAPONY_STATE_DIR` (ย้าย state.db, ชนะ `paths.stateDir`)
- getters รวมศูนย์ใน `src/db/getters.ts` — ห้าม hardcode ค่า default ซ้ำที่ call site

---

## Key Design Decisions

### 1. ทำไม handoff ต้องเป็น structured facts ไม่ใช่ chat transcript

- Transcript ยาว = reviewer (คนหรือ agent) อ่านไม่หมด
- "typecheck ผ่านครบ" เป็นข้อมูลที่พิสูจน์แค่ว่าคอมไพล์ได้ ไม่ใช่ว่า flow หรือ permissions ถูก
- `handoff_collect` → `handoff_check` บังคับให้ claim ของ agent ถูกเทียบกับ git facts จริง ไม่ใช่เชื่อคำพูด
- git facts (files, commits) มาก่อนเสมอเพราะ verifiable; ส่วนที่ agent claim เอง (uncertain, not_done) ติดป้ายแยกชัดว่าพิสูจน์ไม่ได้

### 2. ทำไม cap 2 รอบ (`review.maxRounds`)

- Round 1: agent เขียน code, reviewer ตรวจ
- Round 2: agent แก้ตามที่ reviewer พบ
- Round 3 แปลว่า **plan** มีปัญหา ไม่ใช่โค้ดมีปัญหา → ต้องกลับหาคน เผา token แก้ symptom ไม่จบ

### 3. ทำไม fapony อยู่นอก worktree

- mem.ts ของ product = เกิดอะไรขึ้นกับ product (อยู่ใน git ของ product)
- fapony db = run ไหนถูกวัด/verify ผลอะไร (state ของผู้วัด ไม่ควรอยู่ในที่ที่ผู้ถูกวัดแก้ได้)
- fapony เรียก mem ผ่าน shell adapter ตาม config.memory.* ไม่ใช่ import โดยตรง

### 4. ทำไมใช้ SQLite สำหรับ run state

- bun:sqlite เป็น builtin = 0 dependency
- Run state ต้อง UPDATE (running → awaiting_review → fixing → passed) = append-only JSONL ทำได้แย่
- ถ้าใช้ JSONL ต้อง scan ทั้งไฟล์เพื่อ derive สถานะปัจจุบันทุกครั้ง

---

## Edge Cases ที่จัดการแล้ว

| Edge Case | วิธีจัดการ |
|-----------|-----------|
| Dangerous shell commands (memory claim/close/add, evidence collector cmds, `install`'s `claude mcp add`) | `assertSafe()` deny-list ([src/safety.ts](src/safety.ts)) เรียกก่อนทุก shell spawn ที่มาจาก config — เป็นโค้ด ไม่ใช่ข้อความ |
| fapony เขียนไฟล์ worktree | ห้ามเด็ดขาด — db อยู่ ~/.config/fapony/ เท่านั้น |
| `fapony update` รันจาก src/ | ROOT = `join(import.meta.dir, "..")` — ถ้าพลาดเป็น `import.meta.dir` ตรงๆ git pathspec (`-- bun.lock`) จะ relative กับ src/ → lockfile change ตรวจจับไม่เจอ และ version อ่านจาก package.json ไม่เจอบอก "unknown" (มี tripwire test ใน update.test.ts) |
| ~/.config/fapony/ ไม่มี | mkdirSync(recursive) ก่อนเปิด db |
| `fapony init` ซ้ำ | เช็คทุก dir (plan/spec/memory/evidence.json) → error ถ้าเจอของเก่า ห้ามทับ |
| memory: null + .fapony/.memory/mem.ts มี | default-wiring ใช้ claim/close/add อัตโนมัติ |
| Evidence cmd ที่ agent เสนอเองนอก allowlist | ไม่รันเด็ดขาด — รายงานเป็น *proposed — not executed* ([src/mcp/evidence.ts](src/mcp/evidence.ts)) |
| AI สร้าง plan filename ซ้ำทับของเก่า | `prompts/plan-with-me.md` กฎเหล็ก #7 — `ls plan/` เช็คชื่อชนก่อนเขียนเสมอ |
| test db ทับ production db (`os.homedir()` cache ใน Bun ไม่ตาม `process.env.HOME` ที่เปลี่ยนหลัง process start) | test ที่ isolate db ต้องตั้ง `process.env.FAPONY_STATE_DIR` แทน `process.env.HOME` |

---

## History

fapony started as an execute→review→fix CLI loop (`fapony run`/`loop`/`kickoff`/`gate`/`stop`/`handoff`/
`status`/`plan-mv`) that spawned executor/reviewer agents itself. That loop, and all the code behind it
(`src/run/`, `src/loop/`, `src/plans.ts`, `src/planmv.ts`, `src/status.ts`, `src/stop.ts`, `src/kickoff.ts`,
`src/handoff.ts`, `src/resilience.ts`, `src/sigint.ts`, `src/planlint.ts`), was deleted. fapony no longer
drives any agent — it's a measurement/verification layer any agent calls via MCP (see README.md). What's
left of that era: `runs`/`events` SQLite schema (repurposed — a run row is one measured/verified unit of
work, not one spawned loop iteration), `review.maxRounds` (still read as a cap signal), and the plan/spec
templates + `move-to-done`/`plan-with-me` skills below (now agent-driven, not CLI-enforced).

---

## Rules for AI Agents

1. **ห้ามสร้าง abstraction ที่มี implementation เดียว** — ไม่ scaffold เผื่ออนาคต
2. **ห้าม git push** — กฎจาก vela opencode.json
3. **Commit แยก concern** — one commit per feature/area
4. **assertSafe() ต้องเรียกกับทุก shell command** ที่ spawn จาก config (memory/evidence/install) รวมถึงที่มาจาก template
5. **fapony ห้ามเขียนไฟล์ใน worktree เป้าหมาย** — db อยู่ ~/.config/fapony/ เท่านั้น
6. **memory: null** = ปิดชั้น memory ทั้งหมด ไม่ error

---

## Plan Core — template สำหรับทุก plan

ใช้ [templates/PLAN.md](templates/PLAN.md) กับทุก plan file (ไม่ใช่แค่ fapony) — copy ไปตั้งชื่อ
`.fapony/plan/PLAN-<feature>.md` และ [templates/SPEC.md](templates/SPEC.md) กับทุก spec file
(`.fapony/spec/SPEC-<feature>.md`) **กฎเหล็ก 4 ข้อ** (บังคับ ไม่ใช่แนะนำ): section 1–4 ห้ามขาด (ไม่งั้น plan
ไม่บรรลุนิติภาวะ ไม่ให้ agent ทำ) · section 6 แต่ละขั้นต้อง verify ได้ · section 8 ต้อง link กลับ · **plan =
what/why/order, spec = how in detail** — ห้ามแปะ API shape/schema/wireframe/edge-case ลงใน plan section 7
ตรงๆ ให้ link ไปที่ spec แทน

Spec link กลับหา plan ด้วย (`> **Used by:** [PLAN-x.md](...)`) — ทำให้เป็น graph สองทาง ไม่ต้องมี tooling
เพิ่ม แค่ markdown link ที่ skill `move-to-done` เดินหา inbound link ด้วย grep เอง (ไม่มี CLI enforcement
แล้ว — ดู History ด้านบน)

---

## CLI Commands

```bash
fapony mcp                          # MCP server — stdio JSON-RPC, 6 tools
fapony report <run-id>              # verification report for a run
fapony report-web [file]            # static HTML report page
fapony stats                        # KPIs: pass/stall rate, by-model, by-grade
fapony init <path>                  # scaffold .fapony/ (plan/spec/memory/evidence.json)
fapony install --platform opencode|claude|zcode  # wire mcp.fapony into an MCP client
fapony setup                        # interactive wizard: config + scaffold in one step
fapony update                       # self-update via git pull
fapony telemetry show|send          # opt-in only, default off — see TELEMETRY.md
fapony test                         # self-check
```

<!-- code-review-graph MCP tools -->
## MCP Tools: fapony

fapony ships an MCP server (`fapony mcp`) — stdio JSON-RPC, zero runtime dependency. 6 tools:

| Tool | Purpose |
|------|---------|
| `handoff_collect` | Get machine facts from git (diff stat, commits, branch) |
| `handoff_check` | Verify handoff conformance against facts |
| `verdict_submit` | Store a 6-grade verdict (pass-excellent → uncertain) |
| `fapony_stats` | Query KPIs: by-model, by-grade, by-value |
| `fapony_usage` | Query passive usage from opencode sessions (tokens, cost, by-model) |
| `verification_report` | Full verification report: facts + checks + evidence + verdict + cost |

See [docs/mcp-handcheck.md](docs/mcp-handcheck.md) for full protocol, adapter examples, and safety rules.

## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
