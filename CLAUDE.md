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
    planmv.ts         # archive shipped PLAN → plan/done/ (validate + normalize links + git mv)
    init.ts           # fapony init — scaffold plan/spec/.memory/.fapony
    kickoff.ts        # fapony kickoff — auto-detect pending plan + run
    init-mem.ts       # init-mem command (legacy, superseded by init)
    test.ts           # self-check 27 ตัว
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
  kind TEXT NOT NULL,          -- spawn|commit|handoff|route|gate|stop|stalled|memory_claim|memory_claim_failed|memory_claim_closed|plan
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
    "claim": ["bun", ".memory/mem.ts", "claim", "{id}"],
    "close": ["bun", ".memory/mem.ts", "close", "{id}", "{msg}"],
    "add":   ["bun", ".memory/mem.ts", "add", "{kind}", "{text}"],
    "kickoff": ["bun", ".memory/mem.ts", "kickoff"]
  }
}
```

- `memory: null` = ปิดทั้งชั้น (แต่ถ้า `.memory/mem.ts` มีจริง → default-wiring ใช้ claim/close/add อัตโนมัติ)
- `prefilter: null` = ยังไม่ทำ prefilter DeepSeek (มีช่องรอไว้ใน config แต่ code path ยังไม่ใช้)

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
| Crash หลัง commit ก่อน log mem | events มี commit hash แล้ว; `fapony status` เตือน run ที่มี commit แต่ไม่มี memory event |
| ไม่มี ## HANDOFF ใน stdout | ห้าม fail ทั้ง run → mark handoff_missing แล้วใช้ git-only handoff ต่อ |
| Base SHA | เก็บ HEAD ตอนเริ่ม run (ไม่ใช่ HEAD~1) เพราะ opencode commit หลายก้อนตาม concern |
| ~/.config/fapony/ ไม่มี | mkdirSync(recursive) ก่อนเปิด db |
| `fapony init` ซ้ำ | 逐目 check ทุก dir → error ถ้าเจอของเก่า ห้ามทับ |
| kickoff ambiguous (>1 pending) | คืน error list ชื่อไฟล์ ห้ามเดา |
| memory: null + .memory/mem.ts มี | default-wiring ใช้ claim/close/add อัตโนมัติ |
| Source spec ไม่มีไฟล์ | prompt ใส่ (no spec) — ไม่ error |

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
- Plan file: [plan/done/PLAN-loop.md](plan/done/PLAN-loop.md) (shipped 2fd51e5)

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
`plan/PLAN-<feature>.md` **กฎเหล็ก 3 ข้อ** (บังคับ ไม่ใช่แนะนำ): section 1–4 ห้ามขาด (ไม่งั้น plan
ไม่บรรลุนิติภาวะ ไม่ให้ agent ทำ) · section 6 แต่ละขั้นต้อง verify ได้ · section 8 ต้อง link กลับ

---

## CLI Commands

```bash
fapony run <worktree-key> --plan <path> [--mem-id <id>] [--allow-dirty]
fapony loop <worktree-key> --plan <path>  # start loop
fapony loop <run-id>                      # resume after gate pass
fapony status                    # ตาราง active runs
fapony handoff <run-id>          # reprint handoff ล่าสุด
fapony stop <run-id> [reason]    # stop run + release memory
fapony gate <run-id> pass|fail [note]  # review verdict + memory close
fapony plan-mv <file>          # archive shipped PLAN → plan/done/
fapony init <path>             # scaffold plan/spec/.memory/.fapony
fapony kickoff <worktree-key>  # auto-detect pending plan + run
fapony test                      # self-check 27 ตัว
```
