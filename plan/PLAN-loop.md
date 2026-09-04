# PLAN-loop — chunk 2: loop ครบวง (executor → gate → planner → วนต่อ) + ทุกบทบาทเป็น config

> ต่อจาก chunk 1 (run รอบเดียวจบ: guard → claim → spawn → handoff → route) ไฟล์นี้ทำให้ fapony
> คุม flow จบเองได้: **dev → review → fix → ผ่าน → planner อัปเดต PLAN → ก้อนถัดไป** โดยคนแตะแค่
> 3 จุด (kickoff PLAN / ตอน ping / merge) · พัฒนา fapony **ด้วย fapony เอง** (dogfood บน wt-fapony)

---

## 0. ข้อจำกัด — อ่านก่อน ห้ามออกแบบใหม่เอง

1. **Orchestrator ไม่รู้จัก model** — ทุกบทบาทมาจาก config เท่านั้น (`roles.<name> = { cmd, model }`)
   โค้ด**ห้าม hardcode** `"opencode"` / `"claude"` / ชื่อ model ใดๆ — cmd รับ placeholder `{model}`
   กับ `{id}` ที่ orchestrator แทนค่าเฉยๆ ไม่ตีความ
2. **3 บทบาทคุยกันด้วย marker เท่านั้น** — executor → `## HANDOFF`, gate → `VERDICT: pass|fail`,
   planner → `## NEXT-PROMPT` หรือ `## FILE_DONE` — orchestrator ไม่อ่านข้อความอื่นเป็นคำสั่ง
3. **Schema คุม 2 ตาราง ไม่เพิ่ม** — เพิ่มแค่ `events.kind = 'plan'` (data.kind = `next_prompt`
   | `file_done`) แล้วดึงด้วย pattern เดียวกับ `getPendingFeedback()`
4. **Fail-safe ห้ามเดา** — parse ไม่ได้ / ไม่มี marker → ค้าง `awaiting_review` คืนให้คนเสมอ ·
   เกิน `maxRounds` → `stopped` + ping
5. **planner แก้ PLAN = commit แยก concern** — ห้ามมัดกับโค้ด (กฎเดิมจาก advance-requests Chunk 2)
6. **fapony ห้ามเขียนไฟล์ใน worktree เป้าหมาย** — state อยู่ `~/.config/fapony/` เท่านั้น
7. **Topology:** `fapony/` = main (คุณแตะคนเดียว — merge เมื่อ gate ผ่าน) ·
   `fapony/wt-fapony/` = dev (agents ทำงานที่นี่เท่านั้น) — worktree อยู่**ใน repo** จึงต้อง
   gitignore ก่อน ไม่งั้น dirty-guard ติด untracked noise
8. **ห้าม `git push`** — กฎเดิม

---

## Bootstrap — ทำมือครั้งเดียว ก่อน kickoff ก้อนแรก (ไม่ใช่งาน agent)

```bash
# 1. gitignore ก่อนสร้าง worktree (ไม่งั้น porcelain รก)
echo "wt-*/" >> .gitignore && git add .gitignore && git commit -m "chore: ignore in-repo worktrees"

# 2. worktree dev อยู่ใน repo ตาม topology
git worktree add wt-fapony -b dev

# 3. เพิ่ม key (commit โดยคุณ เพราะ config เป็นของผู้คุม)
#    fapony.config.json: "worktrees": { ..., "fapony": "wt-fapony" }
```

---

## Config — รูปเป้าหมาย (บทบาท = ชื่อ + model ที่รองรับ)

```json
{
  "worktrees": { "vela": "/Users/delamind/Project/innominix/wt-vela", "fapony": "wt-fapony" },
  "roles": {
    "executor": { "cmd": ["opencode", "run", "--model", "{model}"], "model": "mimo", "timeoutMin": 45 },
    "gate":     { "cmd": ["claude", "-p", "{model}", "{PROMPT}"],   "model": "sonnet" },
    "planner":  { "cmd": ["claude", "-p", "{model}", "{PROMPT}"],   "model": "opus" },
    "bigFixer": { "cmd": ["claude", "-p", "{model}", "{PROMPT}"],   "model": "opus" }
  },
  "review": { "bigDiff": { "files": 15, "lines": 400 }, "maxRounds": 2, "autoLoop": false },
  "memory": null
}
```

- `{PROMPT}` = stdin เดิม (write ผ่าน pipe) — `{model}` = substitution ล้วน
- `roles.*` แทนที่ `executor.cmd` + `review.gate` เดิม (migration 1 commit ใน 2b, loadConfig
  merge DEFAULT_CONFIG ให้ครบทุกก้อน)
- `autoLoop: false` (default) = loop หยุดรอที่ `awaiting_review` — gate มือเดิมใช้ได้ทุกจุด

---

## Chunk 2a — contracts + fixtures (ล้วน ไม่แตะ flow) — session เดียวจบ

### Files to create

- **`prompts/planner.md`** — input: PLAN path + git facts + HANDOFF ล่าสุด · กติกา: mark เสร็จ
  กลับเข้าไฟล์ (พร้อม commit hash ทรง PLAN-attention.md) · แยก commit PLAN ออกจากโค้ด ·
  **Required output** (อย่างท้ายสุด): `## NEXT-PROMPT` (prompt ก้อนถัดไป self-contained) **หรือ**
  `## FILE_DONE` + ข้อความ shipped-header — ไม่มีทั้งคู่ = ไม่ผ่าน
- **`prompts/fixer.md`** — input: gate note + diff context · กติกาชุดเดียวกับ execute.md (commit
  แยก concern / banned git) · Required output: `## HANDOFF` ทรงเดิม
- **`src/parse.ts`** — `parseGateVerdict(buf) → { verdict, note }` ·
  `parsePlanUpdate(buf) → { kind: 'next_prompt' | 'file_done', text }` — ตัด marker ท้ายสุดเท่านั้น
- **`test/fixtures/executor.ts`** / **`gate.ts`** / **`planner.ts`** — stub อ่าน stdin → พ่น
  canned output ตรง marker (executor stub ต้อง commit ไฟล์จิ๋วจริง เพื่อให้ gitFacts > 0 แล้ว
  route small) — **ห้ามยิง network เด็ดขาด** (กัน test เผา token โดยพลาด)

### Files to modify

- **`src/test.ts`** — เพิ่ม 3 checks: parseGateVerdict / parsePlanUpdate / fixture-ต้องไม่มี
  `spawn`/`fetch` ในไฟล์ (guard ชั้น 2)
- **`CLAUDE.md`** — sync ให้ตรงโค้ดจริง (ตอนนี้เชยกว่าโค้ด: ไม่มี gate.ts/init-mem/kickoff,
  db path เขียน `~/.fapony/` แต่โค้ดใช้ `~/.config/fapony/`) + เพิ่ม topology ใหม่ตาม §0.7

### Execution order (2a)

1. `src/parse.ts` + test ให้เขียว **ก่อนเขียน prompt ทั้งสอง** (prompt อ้าง marker ที่ parser รับ)
2. `prompts/planner.md` + `prompts/fixer.md`
3. `test/fixtures/*.ts` + guard test
4. `CLAUDE.md` sync
5. `bun run src/test.ts` ครบทั้งหมด

---

## Chunk 2b — runOnce + loop driver (pausable) — session เดียวจบ

### Files to modify

- **`src/run.ts`** — ดึง core flow ออกเป็น `runOnce(opts) → { runId, status, facts, parsed }`:
  `process.exit` ทั้ง 5 จุด → return result (CLI wrapper เท่านั้นที่ exit ตาม result) ·
  `{{PLAN}}` เติมได้ 2 แหล่ง — plan file **หรือ** planner event ล่าสุดของ mem_id เดียวกัน
  (pattern `getPendingFeedback`)
- **`src/db.ts`** — `getLastPlanUpdate(worktree, memId)` + `addEvent` kind `'plan'` (ไม่เพิ่มตาราง)
- **`fapony.ts`** — dispatch `loop`

### Files to create

- **`src/loop.ts`** — `fapony loop <key> --plan <path>` (run ใหม่) / `fapony loop <run-id>`
  (resume จาก runs.status) — วนเป็น step ตามสถานะ: `running → awaiting_review` (จบรอบ,
  พิมพ์ gate cmd ให้คน) · คน gate ผ่าน → resume → planner spawn → `NEXT-PROMPT` → run
  ก้อนถัดไป (วน) / `FILE_DONE` → close id → kickoff PLAN ถัดไป · stall/เกิน cap → `stopped`
  + ping · **ถ้าไม่มี config.roles.planner → หยุดที่ awaiting_review พร้อมแจ้ง** (ไม่ error)

### Files to create (test)

- **`test/fixtures/repo.ts`** — สร้าง temp git repo (init + commit แรก) ให้ loop วนแบบไม่แตะ
  wt จริง · assert สถานะ runs/events ตรงทุก step

### Execution order (2b)

1. `runOnce` refactor + test เดิมต้องเขียวครบ (ไม่พัง chunk 1)
2. `getLastPlanUpdate` + test
3. `src/loop.ts` + test วนครบวงกับ stub (claim → spawn → handoff → route → gate มือจำลอง →
   planner → NEXT-PROMPT → ก้อนถัดไป → FILE_DONE → close)

---

## Chunk 2c — auto-gate + bigFixer lane — session เดียวจบ

### Files to modify

- **`src/gate.ts`** — ดึง logic ออกเป็น `gateOnce(runId, verdict, note)` (cmdGate = CLI wrapper)
- **`src/loop.ts`** — เมื่อ `autoLoop: true`: spawn `roles.gate` (cwd = worktree, capture stdout)
  → `parseGateVerdict` → `gateOnce` · parse ไม่ได้ → ค้าง `awaiting_review` (§0.4)
- **route big** → spawn `roles.bigFixer` (เลน**มีสิทธิ์เขียน** — กติกา execute.md, cwd = worktree)
  → handoff → gate ซ้ำ (เลน gate read-only ไม่เปลี่ยน)

### Files to create

- ถอด skill scrutinize-fix จาก wt-vela → `prompts/fixer.md` (ตัด `pnpm --filter vela-app` ออก
  — ทำใน 2c ไม่ใช่ 2a เพราะต้องลองจริงก่อนว่าใช้ได้กับ repo อื่น)

### Execution order (2c)

1. `gateOnce` refactor (cmdGate มือเดิมต้องเขียวครบ)
2. auto-gate ใน loop + test ด้วย stub gate (canned VERDICT fail → วน fix → pass)
3. bigFixer lane + test (route big → fixer stub → handoff → gate)
4. ทดลองจริง 1 ก้อนบน wt-fapony (dogfood — ครั้งนี้ใช้ token จริง)

---

## Chunk 2d — plan-mv — session เดียวจบ

### Files to create

- **`src/planmv.ts`** — `fapony plan-mv <file>`:
  1. ตรวจ header บรรทัดแรก regex `^> ✅ \*\*.*shipped.*\*\*` — ครอบ**ทั้งไฟล์** (ไม่ใช่แค่
     section เดียว — บั๊ก v1/print) — ไม่ผ่าน → exit 1 พร้อมบอกว่าขาดอะไร
  2. rewrite relative link `](...)` ทุกเส้น บวก `../` อีกชั้น — **normalize ก่อน** (link ที่มี
     `../` อยู่แล้วห้ามกองซ้อน `../../..`)
  3. ไล่ inbound link จากไฟล์อื่นที่ยังชี้ path เก่า → รายงานรายชื่อ (แก้เองถ้าเล็ก / รายงานถ้าเยอะ)
  4. `git mv` ไป `plan/done/`
- **`src/test.ts`** — เพิ่ม check ทรง PLAN จริง (ลอกโครง PLAN-attention.md เป็น fixture)

### Execution order (2d)

1. `planmv.ts` + test กับ fixture plan (header ผ่าน / ไม่ผ่าน / link มี `../` แล้ว / inbound link)
2. ลองจริง 1 ไฟล์บน wt-fapony

---

## Assumptions

- คนเดียวใช้เอง — ไม่ทำ lock/concurrency ข้าม process รอบนี้ (state.db WAL พอ)
- `roles.gate/planner/bigFixer` ยังไม่ผูกกับ mem.ts โดยตรง — คุยผ่าน stdin/stdout marker
  เหมือน executor (fapony เรียก mem ผ่าน config.memory.* เท่านั้น)
- fixture repo อยู่ใต้ temp dir ของ OS — ลบทิ้งตอนจบ test
- ไม่ทำ DeepSeek prefilter (ช่อง `prefilter: null` คงเดิม)

## Edge cases to watch

- **worktree ใน repo = untracked noise ทันที** — gitignore `wt-*/` **ก่อน**สร้าง worktree
  (§ Bootstrap) ไม่งั้น dirty-guard บล็อก run แรก
- **`process.exit` กลาง flow** — loop ตายกลางวง ถ้าลืม refactor จุดใดจุดหนึ่ง → test 2b
  ต้อง assert "runOnce คืน result ไม่ exit" ให้ครบ 5 จุดเดิม
- **gate exit 0 แต่ไม่มี VERDICT** — ห้ามตีเป็น pass → `awaiting_review` (§0.4)
- **planner พ่นไม่ตรง marker** — stall คืนคน ไม่เดาหัวข้อถัดไปเอง
- **state.db ใช้ร่วมกับ runs ของ vela** — worktree column + status filter คุมอยู่แล้ว
  ห้ามไปยุ่ง schema เพื่อแยก
- **stub fixtures ห้าม network** — guard test ไล่หา `spawn`/`fetch` ในไฟล์ fixture
  (ครั้งเดียวที่ใช้ token จริงคือ dogfood ตาม Execution order 2c.4)
- **plan-mv กับ link ลึก** — `plan/done/` อยู่ลึกกว่า `plan/` หนึ่งชั้น ไฟล์ที่ย้ายแล้ว
  (PLAN-attention.md) มี link ต้อง normalize ก่อนบวกเสมอ

---

**Execution prompt (opencode) — chunk 2a เท่านั้น:**

อ่าน `plan/PLAN-loop.md` ทั้งไฟล์ก่อนเริ่ม แล้วทำ **chunk 2a อย่างเดียว ห้ามแตะ 2b-2d** —
§0 คือข้อจำกัดที่ห้ามออกแบบใหม่: โค้ดห้าม hardcode ชื่อ model/ชื่อ tool (ทุกบทบาทมาจาก
config เท่านั้น), schema คุม 2 ตารางห้ามเพิ่ม (เพิ่มได้แค่ events.kind='plan'), ห้าม `git push`,
worktree เป้าหมายคือ repo นี้เอง (agents ทำงานใน worktree เท่านั้น)

ทำตาม Execution order (2a) 5 ข้อตามลำดับ — ข้อ 1 คือ `src/parse.ts` + test ต้องเขียวก่อน
เขียน prompt ทั้งสอง เพราะ prompt อ้าง marker ที่ parser รับ ห้ามกลับลำดับ · fixture stub
ห้ามมี `spawn`/`fetch` เด็ดขาด (มี guard test ไล่ตรวจ) · จบแล้วรัน `bun run src/test.ts`
ให้เขียวครบทุก check แล้ว scrutinize เทียบ §0 + Edge cases ทีละข้อก่อนบอกว่าเสร็จ
