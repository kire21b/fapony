# fapony — Knowledge Base

## What is fapony

CLI orchestrator สำหรับ multi-agent dev loop: `opencode เขียน → review → วนต่อ`. อยู่นอก worktree ของ product (ไม่ใช่ git worktree ของ innominix) เพราะ state ของผู้คุมงานไม่ควรอยู่ในที่ที่ผู้ถูกคุมแก้ได้

**Runtime:** Bun-only, zero runtime dependency — ใช้แค่ `bun:sqlite`, `Bun.spawn`, `node:fs`, `node:child_process`
**State:** SQLite ที่ `~/.config/fapony/state.db` (WAL mode)
**Topology:** `fapony/` = main (คุณแตะคนเดียว — merge เมื่อ gate ผ่าน) · `fapony/wt-fapony/` = dev (agents ทำงานที่นี่เท่านั้น) — worktree อยู่ใน repo จึงต้อง gitignore `wt-*/` ก่อน
**License:** MIT, public ตั้งแต่ commit แรก

---

## Architecture

```
fapony/
  fapony.ts           # CLI dispatch (33 บรรทัด)
  fapony.config.json  # runtime config (worktrees, executor, review gate, memory)
  package.json        # bin: { fapony: "./fapony.ts" }, ไม่มี dependencies
  prompts/
    execute.md        # execution prompt template ที่ inject เข้า executor
    planner.md        # planner prompt — mark เสร็จ + NEXT-PROMPT/FILE_DONE
    fixer.md          # fixer prompt — แก้ตาม gate note แล้ว HANDOFF
    scrutinize-fix.md # two-phase review + fix in one round (ported from vela)
                          # ← อยู่ใน prompts/ เพราะถูกใช้เป็น role (review gate), ไม่ใช่ standalone skill
  skill/
    git-commit-conventional.md  # commit แยก concern + conventional message
    move-to-done.md             # archive PLAN หลัง ship
    plan-with-me.md             # draft plan + spec จาก conversation
  src/
    db.ts             # SQLite schema + loadConfig() + CRUD (222 บรรทัด)
    run.ts            # flow หลัก: guard → claim → spawn → facts → route + spec injection
    gate.ts           # gate CLI: pass/fail verdict + memory close (67 บรรทัด)
    handoff.ts        # gitFacts() + parseHandoff() + renderHandoff() (159 บรรทัด)
    parse.ts          # parseGateVerdict() + parsePlanUpdate() (67 บรรทัด)
    memory.ts         # shell adapter + resolveMemoryConfig + DEFAULT_MEMORY (70 บรรทัด)
    safety.ts         # assertSafe() deny-list (19 บรรทัด)
    status.ts         # ตาราง runs ที่ยังไม่ passed/stopped (33 บรรทัด)
    stop.ts           # stop run + release memory claim (47 บรรทัด)
    loop.ts           # loop driver: run → review → planner → repeat (pausable)
    planmv.ts         # archive shipped PLAN → .fapony/plan/done/ (validate + normalize links + git mv)
    init.ts           # fapony init — scaffold .fapony/{plan,spec,.memory}
    kickoff.ts        # fapony kickoff — auto-detect pending plan + run
    init-mem.ts       # init-mem command (legacy, superseded by init)
    planlint.ts       # checkPlanHygiene() — warn เมื่อ spec content หลุดเข้า plan
    stats.ts          # fapony stats — KPI + cost total ข้าม run
    telemetry.ts      # opt-in payload (runs/events/cost allowlist เท่านั้น)
    test.ts           # self-check 36 ตัว
  test/
    fixtures/
      executor.ts     # stub executor — commit + HANDOFF (no network)
      gate.ts         # stub gate — VERDICT pass/fail (no network)
      planner.ts      # stub planner — NEXT-PROMPT/FILE_DONE (no network)
```

---

## Execution Flow

```
PLAN (คุณ + Claude)
  │
  ▼
fapony run <worktree-key> --plan <path> [--mem-id <id>] [--allow-dirty]
  │
  ├─ 1. GIT GUARD
  │     - assertSafe(): deny reset --hard / clean -f / checkout -- / stash
  │     - ถ้า git status --porcelain ไม่ว่าง && ไม่มี --allow-dirty → exit 1
  │     - ห้ามเขียนไฟล์ใดๆ ลง worktree เป้าหมาย
  │
  ├─ 2. BASE SHA + INSERT RUN
  │     - เก็บ HEAD ปัจจุบันเป็น base (ไม่ใช่ HEAD~1)
  │     - insert runs(status='running', round=0)
  │
  ├─ 3. MEMORY CLAIM (optional)
  │     - รัน config.memory.claim shell cmd (cwd = worktree)
  │     - ล้มเหลวไม่ต้องหยุด run แค่ log event
  │
  ├─ 4. SPAWN EXECUTOR
  │     - สร้าง prompt จาก prompts/execute.md + plan content + mem_id
  │     - ถ้า plan header มี Source spec → อ่านไฟล์ spec แนบท้าย prompt (truncated)
  │     - Bun.spawn ด้วย config.executor.cmd, cwd = worktree
  │     - เขียน prompt ทาง stdin, stream stdout ออกจอ + เก็บ buffer
  │     - timeout หรือ exit!=0 → status='stalled' + memory release + exit 1
  │
  ├─ 5. GIT FACTS + PARSE HANDOFF
  │     - gitFacts(worktree, baseSha) → { files, lines, commits, branch }
  │     - parseHandoff(buffer) → { claimed, commits, checks, uncertain, not_done, missing }
  │
  ├─ 6. ROUTE
  │     - files > 15 || lines > 400 → "big" (review เต็ม)
  │     - ไม่งั้น → "small" (review ปกติ)
  │     - status = 'awaiting_review'
  │
  └─ 7. PRINT HANDOFF + NEXT STEP
        - renderHandoff() = ส่วน git facts นำหน้าเสมอ + executor report ต่อท้าย
        - พิมพ์คำสั่ง review gate ให้ user รันเอง (chunk 1 ยังไม่ auto-drive)
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
  kind TEXT NOT NULL,          -- spawn|spawn_fail|commit|handoff|route|gate|stop|stalled|interrupted|memory_claim|memory_claim_failed|memory_claim_closed|plan
  data TEXT                    -- json
)
```

**หลักคิด:** events คือ audit trail ที่เป็นข้อเท็จจริง (ไม่ใช่ transcript) — มาแทน "copy chat ทั้งหมด"

---

## Config Schema

```json
{
  "worktrees": { "<key>": "<absolute-path>" },
  "executor": { "cmd": ["opencode", "run"], "timeoutMin": 45 },
  "review": {
    "bigDiff": { "files": 15, "lines": 400 },
    "maxRounds": 2,
    "gate": ["claude", "-p", "/code-review high"],
    "prefilter": null
  },
  "memory": {
    "claim": ["bun", ".fapony/.memory/mem.ts", "claim", "{id}"],
    "close": ["bun", ".fapony/.memory/mem.ts", "close", "{id}", "{msg}"],
    "add":   ["bun", ".fapony/.memory/mem.ts", "add", "{kind}", "{text}"],
    "kickoff": ["bun", ".fapony/.memory/mem.ts", "kickoff"]
  },
  "telemetry": { "enabled": false, "endpoint": "https://your-server/ingest" },
  "pricing": { "<role>": { "inputPer1k": 3.0, "outputPer1k": 15.0 } }
}
```

- `pricing` — optional, per-role USD per 1k tokens. Every spawn logs `role`/`model` + byte in/out into the `spawn` event regardless; `pricing` (or its absence/`null`) only toggles whether a labeled `usd_estimate` is attached — bytes are a declared proxy, not real token counts, and USD is never a real charge (see [TELEMETRY.md](TELEMETRY.md), `src/stats.ts`, `src/telemetry.ts`)

- `telemetry` — opt-in only (omit or `null` = off). ดู [TELEMETRY.md](TELEMETRY.md) ว่าส่งฟิลด์อะไรบ้าง (runs + event kind/timestamp เท่านั้น ไม่มี plan/commit/gate-note content)

- `memory: null` = ปิดทั้งชั้น (แต่ถ้า `.fapony/.memory/mem.ts` มีจริง → default-wiring ใช้ claim/close/add อัตโนมัติ)
- `prefilter: null` = ยังไม่ทำ prefilter DeepSeek (มีช่องรอไว้ใน config แต่ code path ยังไม่ใช้)

### Config เสริม (optional ทั้งหมด — ไม่ใส่ = ค่าเดิมที่เคย hardcode)

```json
{
  "prompts": { "executor": "prompts/execute.md", "gate": null, "planner": null, "bigFixer": null, "scrutinizeFix": "prompts/scrutinize-fix.md" },
  "spec": { "maxLines": 200, "sourceMarker": "^>\\s*\\*\\*Source spec:\\*\\*\\s*(.+)$" },
  "markers": { "handoff": "## HANDOFF", "verdict": "^VERDICT:\\s*(pass|fail)\\s*$", "nextPrompt": "## NEXT-PROMPT", "fileDone": "## FILE_DONE", "shipped": "^>\\s*✅\\s*\\*\\*.*shipped.*\\*\\*" },
  "paths": { "planDir": ".fapony/plan", "specDir": ".fapony/spec", "memoryEntry": ".fapony/.memory/mem.ts", "doneDir": "done", "linkScanDirs": [".fapony/plan/", ".fapony/spec/", "docs/"] },
  "safety": { "deny": ["reset\\s+--hard", "clean\\s+-[a-z]*f", "checkout\\s+--\\s", "git\\s+stash"] },
  "plan": { "extensions": [".md"], "maxLines": 200 },
  "planmv": { "archiveMsg": "chore(plan): archive {file} (shipped {hash})", "inboundWarnAt": 5 },
  "display": { "dirtyPreview": 10, "shortSha": 8 },
  "defaults": { "timeoutMin": 10 }
}
```

- `prompts.<role> = null` = ใช้ inline fallback เดิม · `gate/planner/bigFixer` มี `{{RUN_ID}} {{WORKTREE}} {{MEM_ID}} {{FILES}} {{LINES}}` ให้ใช้ใน template
- `defaults.timeoutMin` = fallback เมื่อ `roles.<name>.timeoutMin` ไม่ได้ตั้ง (ไม่ตั้งเลย → gate/planner 10, bigFixer 20, scrutinizeFix 15)
- env override: `FAPONY_CONFIG` (เลือกไฟล์ config), `FAPONY_STATE_DIR` (ย้าย state.db)
- getters รวมศูนย์ใน `src/db/getters.ts` (`specMaxLines()`, `shippedRE()`, `roleTimeoutMin()`, …) — ห้าม hardcode ค่าเดิมซ้ำที่ call site

---

## Key Design Decisions

### 1. ทำไม handoff ต้องเป็น template ไม่ใช่ chat transcript

- Transcript ยาว = reviewer อ่านไม่หมด
- "typecheck ผ่านครบ" เป็นข้อมูลที่พิสูจน์แค่ว่าคอมไพล์ได้ ไม่ใช่ว่า flow หรือ permissions ถูก
- Handoff template บังคับให้ executor produce structured summary ที่ reviewer บริโภคได้จริง
- ส่วน git facts (files, commits) นำหน้าเสมอเพราะเป็น verifiable; ส่วน executor report (uncertain, not_done) ต่อท้ายและติดป้ายว่ามาจาก executor

### 2. ทำไม cap 2 รอบ

- Round 1: executor เขียน code, reviewer ตรวจ
- Round 2: executor แก้ตามที่ reviewer พบ
- Round 3 แปลว่า **plan** มีปัญหา ไม่ใช่โค้ดมีปัญหา → ต้องกลับหาคน เผา token แก้ symptom ไม่จบ

### 3. ทำไม fapony อยู่นอก worktree

- mem.ts ของ vela = เกิดอะไรขึ้นกับ product (อยู่ใน git ของ product)
- fapony db = run ไหนอยู่รอบไหน (state ของผู้คุมงาน ไม่ควรอยู่ในที่ที่ผู้ถูกคุมแก้ได้)
- fapony เรียก mem ผ่าน shell adapter ตาม config.memory.* ไม่ใช่ import โดยตรง

### 4. ทำไมใช้ SQLite สำหรับ run state

- bun:sqlite เป็น builtin = 0 dependency
- Run state ต้อง UPDATE (running → awaiting_review → fixing → passed) = append-only JSONL ทำได้แย่
- ถ้าใช้ JSONL ต้อง scan ทั้งไฟล์เพื่อ derive สถานะปัจจุบันทุกครั้ง

---

## Edge Cases ที่จัดการแล้ว

| Edge Case | วิธีจัดการ |
|-----------|-----------|
| Dangerous git commands | `assertSafe()` deny-list ใน run.ts — เป็นโค้ด ไม่ใช่ข้อความ |
| Dirty working tree | หยุดถาม + exit 1 ไม่ใช่ล้างเอง ห้ามstash/clean |
| fapony เขียนไฟล์ worktree | ห้ามเด็ด镩 — db อยู่ ~/.config/fapony/ เท่านั้น |
| Executor ค้าง | timeout จาก config → status='stalled' + release claim |
| Ctrl-C กลาง run/loop | one-way door: handler ใน [src/sigint.ts](src/sigint.ts) log `interrupted` + mark `stopped` + release memory claim แล้ว exit 130 — stopped run resume ไม่ได้ (by design = give up) · cleanup เป็น sync ทั้งหมด ไม่มี "2nd Ctrl-C" |
| `fapony update` รันจาก src/ | ROOT = `join(import.meta.dir, "..")` — ถ้าพลาดเป็น `import.meta.dir` ตรงๆ git pathspec (`-- bun.lock`) จะ relative กับ src/ → lockfile change ตรวจจับไม่เจอ และ version อ่านจาก package.json ไม่เจอบอก "unknown" (มี tripwire test ใน update.test.ts) |
| Crash หลัง commit ก่อน log mem | events มี commit hash แล้ว; `fapony status` เตือน run ที่มี commit แต่ไม่มี memory event |
| ไม่มี ## HANDOFF ใน stdout | ห้าม fail ทั้ง run → mark handoff_missing แล้วใช้ git-only handoff ต่อ |
| Base SHA | เก็บ HEAD ตอนเริ่ม run (ไม่ใช่ HEAD~1) เพราะ opencode commit หลายก้อนตาม concern |
| ~/.config/fapony/ ไม่มี | mkdirSync(recursive) ก่อนเปิด db |
| `fapony init` ซ้ำ | 逐目 check ทุก dir → error ถ้าเจอของเก่า ห้ามทับ |
| kickoff ambiguous (>1 pending) | คืน error list ชื่อไฟล์ ห้ามเดา |
| memory: null + .fapony/.memory/mem.ts มี | default-wiring ใช้ claim/close/add อัตโนมัติ |
| Source spec ไม่มีไฟล์ | prompt ใส่ (no spec) — ไม่ error |
| log.jsonl บวม (multi-agent, มี decision/note เยอะ) | `mem rotate --apply` — `git mv` archive แถวที่ resolved แล้ว (close/spec synced) เหลือแค่ open work + unresolved ใน log.jsonl (default threshold 3000 rows, `MEM_ROTATE_THRESHOLD` ปรับได้) |
| ดูแต่ NEXT-PROMPT + mem_id ไม่เปิด plan เลย | `fapony status` แสดง plan path + mem_id ในตารางเดียวกัน ([src/status.ts](src/status.ts)) — ไม่เขียนกลับเข้า plan file (ผิดกฎ #5) |
| AI สร้าง plan filename ซ้ำทับของเก่า | `prompts/plan-with-me.md` กฎเหล็ก #7 — `ls plan/` เช็คชื่อชนก่อนเขียนเสมอ |
| `plan/done/` ต้องเปิดทีละไฟล์เพื่อดู ship date | `planMv()` prefix ชื่อไฟล์ด้วย `YYYY-MM-DD-` ตอน archive ([src/planmv.ts](src/planmv.ts)) — เห็นวันที่จาก `ls` ตรงๆ |
| test db ทับ production db (`os.homedir()` cache ใน Bun ไม่ตาม `process.env.HOME` ที่เปลี่ยนหลัง process start) | test ที่ isolate db ต้องตั้ง `process.env.FAPONY_STATE_DIR` แทน `process.env.HOME` |

---

## Integration with vela

fapony ถูก config ให้ทำงานกับ worktree ของ vela (key `"vela"` ใน `fapony.config.json`) —
รายละเอียดว่าอะไรย้ายมาจาก wt-vela / อะไรไม่ย้าย / หน้าตา config เดิมของ vela เป็นยังไง
ย้ายไปอยู่ [docs/vela-migration.md](docs/vela-migration.md) แล้ว (ประวัติ อ่านเมื่อสงสัย
ไม่ใช่ทุกครั้งที่ทำงาน)

---

## Chunk Roadmap

### Chunk 1 (เสร็จแล้ว) — repo skeleton + run รอบเดียวจบ
- [x] git init + package.json + .gitignore
- [x] fapony.ts CLI dispatch
- [x] src/db.ts — SQLite schema + loadConfig()
- [x] src/handoff.ts — gitFacts() + parseHandoff() + renderHandoff()
- [x] src/run.ts — full flow
- [x] prompts/execute.md + fapony.config.json
- [x] README.md + self-test
- [x] ไม่ auto-drive Claude Code (user รัน review เอง)
- [x] ไม่ทำ prefilter DeepSeek

### Chunk 2 (เสร็จแล้ว) — auto-drive + review loop
- [x] 2a: src/parse.ts + prompts/planner.md + prompts/fixer.md + test fixtures
- [x] 2b: runOnce + loop driver (pausable)
- [x] 2c: auto-gate + bigFixer lane
- [x] 2d: plan-mv
- DeepSeek prefilter (prefilter: null ยังคงเดิม — deferred ไม่ใช่ chunk 2 scope)
- [x] ย้าย scrutinize-fix skill → prompts/scrutinize-fix.md (ถอด vela แล้ว)
- [x] skill/git-commit-conventional.md + skill/move-to-done.md + skill/plan-with-me.md
- Plan file: [plan/done/2026-09-05-PLAN-loop.md](plan/done/2026-09-05-PLAN-loop.md) (shipped 2fd51e5)

### Pre-condition ก่อน chunk 2
- ต้องรัน chunk 1 กับ vela จริงสัก 2-3 รอบแล้วเห็นว่า handoff template ใช้ได้จริง

### สิ่งที่กำลังจะทำต่อ
ดู [ROADMAP.md](ROADMAP.md) — chunk ที่เสร็จ (1, 2) เก็บไว้ที่นี่เป็นประวัติ ส่วนงานที่ยังไม่เริ่ม
อยู่ใน ROADMAP.md ที่เดียว (กัน duplicate 2 ที่ไม่ sync กัน) plan file รายละเอียดอยู่ใต้ `plan/`

---

## Rules for AI Agents

1. **ห้ามสร้าง abstraction ที่มี implementation เดียว** — ไม่ scaffold เผื่ออนาคต
2. **ห้าม git push** — กฎจาก vela opencode.json
3. **Commit แยก concern** — one commit per feature/area
4. **assertSafe() ต้องเรียกกับทุก command** ก่อน spawn รวมถึงที่มาจาก config
5. **fapony ห้ามเขียนไฟล์ใน worktree เป้าหมาย** — db อยู่ ~/.config/fapony/ เท่านั้น
6. **status ที่ถูกต้อง:** running → awaiting_review → fixing → passed | stopped | stalled
7. **round cap:** ถ้า round > maxRounds → STOP, plan มีปัญหา
8. **memory: null** = ปิดชั้น memory ทั้งหมด ไม่ error

---

## Plan Core — template สำหรับทุก plan

ใช้ [templates/PLAN.md](templates/PLAN.md) กับทุก plan file (ไม่ใช่แค่ fapony) — copy ไปตั้งชื่อ
`.fapony/plan/PLAN-<feature>.md` และ [templates/SPEC.md](templates/SPEC.md) กับทุก spec file
(`.fapony/spec/SPEC-<feature>.md`) **กฎเหล็ก 4 ข้อ** (บังคับ ไม่ใช่แนะนำ): section 1–4 ห้ามขาด (ไม่งั้น plan
ไม่บรรลุนิติภาวะ ไม่ให้ agent ทำ) · section 6 แต่ละขั้นต้อง verify ได้ · section 8 ต้อง link กลับ · **plan =
what/why/order, spec = how in detail** — ห้ามแปะ API shape/schema/wireframe/edge-case ลงใน plan section 7
ตรงๆ ให้ link ไปที่ spec แทน

Spec link กลับหา plan ด้วย (`> **Used by:** [PLAN-x.md](...)`) — ทำให้เป็น graph สองทาง ไม่ต้องมี tooling
เพิ่ม แค่ markdown link ที่ `fapony plan-mv` เดินหา inbound link อยู่แล้ว (`linkScanDirs` คลุมทั้ง `plan/` และ
`spec/`)

**Enforcement:** `fapony run` เรียก `checkPlanHygiene()` ([src/planlint.ts](src/planlint.ts)) ก่อน spawn
executor ทุกครั้ง — เตือน (ไม่ block) เมื่อ plan ยาวเกิน `plan.maxLines` (default 200) หรือ section 7 บวมทั้งที่
มี Source spec ผูกอยู่แล้ว (สัญญาณว่า spec content หลุดเข้ามาใน plan)

---

## CLI Commands

```bash
fapony run <worktree-key> --plan <path> [--mem-id <id>] [--allow-dirty]
fapony loop <worktree-key> --plan <path>  # start loop
fapony loop <run-id>                      # resume after gate pass
fapony status                    # ตาราง active runs
fapony stats                     # KPI ข้าม run ทั้งหมด — pass/stall rate, avg rounds, exec/review time
fapony telemetry show|send       # opt-in เท่านั้น (default off) — ดู TELEMETRY.md ว่าส่งอะไรบ้าง
fapony handoff <run-id>          # reprint handoff ล่าสุด
fapony stop <run-id> [reason]    # stop run + release memory
fapony gate <run-id> pass|fail [note]  # review verdict + memory close
fapony plan-mv <file>          # archive shipped PLAN → .fapony/plan/done/
fapony init <path>             # scaffold .fapony/ (plan/spec/.memory ข้างใน)
fapony kickoff <worktree-key>  # auto-detect pending plan + run
fapony test                      # self-check 36 ตัว
```

<!-- code-review-graph MCP tools -->
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
