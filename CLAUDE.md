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
    run.ts            # flow หลัก: guard → claim → spawn → facts → route (227 บรรทัด)
    gate.ts           # gate CLI: pass/fail verdict + memory close (67 บรรทัด)
    handoff.ts        # gitFacts() + parseHandoff() + renderHandoff() (159 บรรทัด)
    parse.ts          # parseGateVerdict() + parsePlanUpdate() (67 บรรทัด)
    memory.ts         # shell adapter helpers for config.memory.* (45 บรรทัด)
    safety.ts         # assertSafe() deny-list (19 บรรทัด)
    status.ts         # ตาราง runs ที่ยังไม่ passed/stopped (33 บรรทัด)
    stop.ts           # stop run + release memory claim (47 บรรทัด)
    loop.ts           # loop driver: run → review → planner → repeat (pausable)
    init-mem.ts       # init-mem command
    test.ts           # self-check 7 ตัว (250 บรรทัด)
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

**设计理念:** events คือ audit trail ที่เป็นข้อเท็จจริง (ไม่ใช่ transcript) — มาแทน "copy chat ทั้งหมด"

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

- `memory: null` = ปิดทั้งชั้น (คนนอกใช้ได้ทันทีโดยไม่ต้องมี mem.ts)
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

---

## Integration with vela

fapony ถูก config ให้ทำงานกับ worktree ของ vela:

```json
{
  "worktrees": {
    "vela": "/Users/delamind/Project/innominix/wt-vela"
  }
}
```

### ไฟล์จาก wt-vela ที่ "ย้าย" มาใช้ (คัดลอก + ถอด vela ออก ไม่ใช่ git mv)

| From | To | หมายเหตุ |
|------|-----|---------|
| เกณฑ์ใน CLAUDE.md (route review, cap 2 รอบ, commit แยก concern) | `fapony.config.json` | สำคัญสุด — อยู่ในภาษาคน คนอื่นเอาไปใช้ไม่ได้ |
| opencode.json → instructions[3] (กฎ commit/no-push) | `prompts/execute.md` | ต่อท้ายทุก execution prompt |
| .claude/hooks/guard-git.sh | ฝังเป็นโค้ดใน `run.ts` | เป็นข้อความ = ไม่ enforce ต้องเป็น code |

### ไฟล์ที่ "ไม่ย้าย" (ยังอยู่ใน wt-vela)

| File | เหตุผล |
|------|--------|
| `.memory/mem.ts` | เรียกผ่าน config.memory.* shell template ไม่ใช่ import |
| `.opencode/plugins/memory-claims.ts` | ผูกกับ opencode plugin API ไม่ใช่หน้าที่ orchestrator |
| `.opencode/skill/scrutinize-fix/` | ~~chunk 2 — ต้องถอด pnpm --filter vela-app ออกก่อน~~ ✅ ported แล้ว → `prompts/scrutinize-fix.md` |

---

## Reference: vela .memory system

mem.ts เป็น CLI dispatch 62 บรรทัด + store/selectors/render/commands/ แยกไฟล์:
- **Log:** append-only JSONL ที่ `apps/<app>/.memory/log.jsonl`
- **Row kinds:** next, bug, decision, note, hold (work items) + close, claim, release, synced (lifecycle)
- **Agent stamp:** `MEM_AGENT` env (fallback: `USER`)
- **staleReport:** ตรวจ decisions ที่ใหม่กว่า spec's last commit, claims แก่กว่า 4 ชม.

---

## Reference: vela opencode.json

```json
{
  "instructions": [
    "apps/vela/CLAUDE.md",
    ".opencode/memory-enforce.md",
    "Always load code-review-graph MCP tools first",
    "Commit as you go split by concern, never push"
  ],
  "mcp": {
    "code-review-graph": { "command": ["npx", "code-review-graph", "serve", "--auto-watch"] }
  }
}
```

---

## Reference: vela scripts/commit.ts

AI-powered git commit message generator (108 บรรทัด):
- ใช้ `git diff --stat` + `git diff HEAD` ส่งให้ Claude Haiku 4.5 สร้าง conventional commit message
- สองโหมด: ถ้า message มาก่อน → commit ตรง, ไม่งั้น → generate แล้ว commit

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

### Chunk 2 (กำลังทำ) — auto-drive + review loop
- [x] 2a: src/parse.ts + prompts/planner.md + prompts/fixer.md + test fixtures
- [x] 2b: runOnce + loop driver (pausable)
- [x] 2c: auto-gate + bigFixer lane
- [ ] 2d: plan-mv
- DeepSeek prefilter (prefilter: null ยังคงเดิม)
- [x] ย้าย scrutinize-fix skill → prompts/scrutinize-fix.md (ถอด vela แล้ว)
- [x] skill/git-commit-conventional.md + skill/move-to-done.md + skill/plan-with-me.md

### Pre-condition ก่อน chunk 2
- ต้องรัน chunk 1 กับ vela จริงสัก 2-3 รอบแล้วเห็นว่า handoff template ใช้ได้จริง

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

ใช้ template นี้กับทุก plan file (ไม่ใช่แค่ fapony):

```markdown
# PLAN-<feature>.md —<short name>

> **Status:** 🚧 in-progress · **Owner:** <dev> · **Created:** <YYYY-MM-DD>
> **Source spec:** [spec/<feature>.md](../spec/<feature>.md) — ถ้ามี

---

## 1. เป้าหมาย (ทำไม)
1–3 sentences — ถ้าอ่านแล้วตอบ "แล้วไง" ไม่ได้ = ยังไม่ชัด

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)
**ทำ:** 3–7 bullets, outcome ไม่ใช่ task
**ไม่ทำ:** 2–5 bullets + เหตุผล 1 บรรทัดต่อข้อ

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)
3–6 bullets — ทดสอบได้ (test pass / command รันได้ / user ทำซ้ำได้)
ห้ามเขียน "เสร็จ" ลอยๆ — ต้องวัดได้

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)
3–8 bullets — ข้อที่ละเมิดแล้วพัง (ไม่ใช่ "แนวปฏิบัติที่ดี")

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)
ตาราง 3–5 แถว: เสี่ยง | โอกาส | ผลกระทบ | ทางหนี

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)
1. **<Step 1>** — มี deliverable ชัด
2. **<Step 2>** — ...
แต่ละขั้นต้อง verify ได้ก่อนไปขั้นถัดไป

## 7. ตัวอย่าง (เห็นภาพ)
bash examples: ก่อน / หลัง

## 8. อ้างอิง
- link กลับไฟล์ที่เกี่ยวข้อง
```

**กฎเหล็ก 3 ข้อ:**
- Section 1–4 ห้ามขาด — ถ้าขาด = plan ไม่บรรลุนิติภาวะ ไม่ให้ agent ทำ
- Section 6 แต่ละขั้นต้อง verify ได้ — ถ้าทำแล้วไม่รู้ว่าผ่าน = ยังไม่ชัด
- Section 8 ต้อง link กลับ — กันหลงทิศและให้ context ตอน reopen

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
fapony test                      # self-check 7 ตัว
```
