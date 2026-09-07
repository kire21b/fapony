# PLAN-resilience.md — retry + backoff + interrupt logging ให้ agent spawn ทน limit

> ✅ **shipped** (68ac21d)
> **Owner:** delamind · **Created:** 2026-09-07
> **Source spec:** [SPEC-resilience.md](../../spec/SPEC-resilience.md)

---

## 1. Goal (why)

วันนี้ agent (executor / gate / planner / fixer) ติด provider limit (rate limit, usage cap,
credit หมด) หรือล่มชั่วคราว → fapony mark `stalled` แล้ว loop ตายทันที
([src/run/flow.ts:139-148](../../src/run/flow.ts), [src/loop/index.ts:223-226](../../src/loop/index.ts))
— คนต้องนั่งเฝ้าแล้วกด resume เองทุกครั้ง ซึ่งขัดกับตัวตนของ multi-agent loop

เป้าหมาย: fapony จัดการความล้มเหลวชั่วคราวได้เอง — **retry + backoff** ตอนติด limit/ล่ม
และ**หยุดกลางคันได้แบบสะอาด** (`fapony stop` / Ctrl-C ตัด retry ที่กำลังรอ backoff, mark
สถานะถูกต้อง, release memory) — รวมเป็น lib เดียว (`src/resilience.ts`) ที่ spawn ทั้ง 2 จุดใช้ร่วมกัน
ทุกความล้มเหลว/การขัดจังหวะ **ต้อง log เป็น event** (จำนวนครั้ง, class, ตอนไหน) เพื่อเอาไปดู
ย้อนหลังว่าเจอ limit/ต้องยกเลิกบ่อยแค่ไหน ใช้ตัดสินใจ tuning รอบต่อไป

> **Scope cut (2026-09-07):** ตัด circuit breaker ออกจาก plan นี้ — ดู § Scope ข้อ Don't do
> เหตุผลอยู่ที่นั่น ดีไซน์ breaker เต็มยังอยู่ใน [SPEC-resilience.md](../../spec/SPEC-resilience.md)
> รอ PLAN-2 ถ้า retry อย่างเดียวไม่พอจริง

## 2. Scope (do / don't do)

**Do:**
- `src/resilience.ts` pure core: classify failure (`limit|auth|timeout|crash|empty`),
  exponential backoff + full jitter, interruptible retry wrapper — ถูกใช้จริงทั้ง
  [src/run/spawn.ts](../../src/run/spawn.ts) และ [src/loop/spawn.ts](../../src/loop/spawn.ts)
  (2 consumer ⇒ ไม่ละเมิดกฎห้าม abstraction เดียว)
- event kind ใหม่ `spawn_fail` (ทุกครั้งที่ classify เจอความล้มเหลว ก่อน retry/ก่อน stalled)
  และ `interrupted` (ทุกครั้งที่ `fapony stop`/SIGINT ตัดกลางคัน) — append-only audit ตาม
  ปรัชญา events (ไม่แตะ schema) นับได้ตรงๆ ด้วย `SELECT COUNT(*) ... WHERE kind='interrupted'`
  หรือ group by `json_extract(data,'$.cls')` สำหรับ spawn_fail — เอาไปพัฒนาต่อ (เช่นเห็นว่า
  limit ชนบ่อยช่วงไหน ควรปรับ backoff เริ่มต้นเท่าไหร่)
- **กัน retry อันตราย:** retry ได้เฉพาะเมื่อ HEAD ไม่ขยับจากก่อน spawn + `status --porcelain`
  ว่าง (pre-spawn sha snapshot) — executor ที่โดน kill หลัง commit บางก้อน = stalled เหมือนเดิม
- **SIGINT handler ใหม่ที่ [fapony.ts](../../fapony.ts)** (จุดเดียว ไม่มีอยู่ก่อนเลยตอนนี้ — เช็คแล้ว
  `grep SIGINT src/` ว่างเปล่า): จับ SIGINT ครั้งแรก → log event `interrupted` (พร้อม
  run_id ปัจจุบันถ้ามี, `during: "backoff"|"spawn"`) → mark run `stopped` + release memory
  (เรียก path เดียวกับ [src/stop.ts](../../src/stop.ts)) → exit 130 ครั้งที่สอง (กด Ctrl-C ซ้ำ) =
  force exit ทันทีไม่ต้องรอ cleanup (กันค้างถ้า cleanup เอง hang)
- `fapony stop` จากอีก terminal ระหว่างรอ backoff → `isAborted()` เห็น status เปลี่ยนก่อน
  attempt ถัดไป/ระหว่าง sleep chunk → ออกทันที (ไม่ต้องพึ่ง signal เพราะเป็นคนละ process)
- config `resilience` (optional — ไม่ใส่ = default conservative, `null` = ปิดทั้งชั้นคืนพฤติกรรมเดิม)
  + getters รวมที่ [src/db/getters.ts](../../src/db/getters.ts)

**Don't do:**
- ❌ **circuit breaker (state machine open/half_open/closed, window, cooldown escalation)** —
  ตัดออกจาก scope นี้ retry ที่มี `maxAttempts` cap อยู่แล้วให้ผลเดียวกันในทางปฏิบัติ (พัง
  ครบโควตา = fail แล้วจบ) breaker แก้ปัญหาที่ยังไม่เกิดจริง (เผา token ข้าม *run* ซ้ำๆ) —
  รอดูจาก event `spawn_fail` ที่ log ไว้ก่อนว่าเป็นปัญหาจริงแค่ไหน ค่อยทำ PLAN-2 (spec มีรออยู่แล้ว)
- ❌ retry คำสั่ง git ย่อย (guard/gitFacts/handoff) — fail fast ถูกต้องอยู่แล้ว
- ❌ แตะ DB schema — คง 2 ตาราง
- ❌ เพิ่ม RunStatus — ใช้ `stalled`/`stopped` เดิม (status enum ห้ามขยาย)
- ❌ เพิ่ม dependency (zero-dep rule)

## 3. Done criteria (how we know it's finished)

- `fapony test` ผ่านครบ รวม test ใหม่: classify (pure), backoff math (pure),
  retry-สำเร็จหลังพัง 2 ครั้ง (fixture), stop-ระหว่าง-backoff abort, SIGINT handler
  (จำลองด้วย fixture — ไม่ยิง SIGINT ใส่ test runner จริง)
- จำลองติด limit ได้จริง: fixture agent exit 1 พร้อมข้อความ "rate limit" 2 ครั้ง →
  fapony retry อัตโนมัติ → run ไปต่อจบโดยไม่ต้องมีคนกด
- `fapony stop` (จาก terminal อื่น) ระหว่างรอ backoff → process ออกทันที, run = `stopped`,
  memory release, event `interrupted` ถูก log
- Ctrl-C ระหว่าง spawn/backoff → run = `stopped`, memory release, event `interrupted`
  ถูก log พร้อม `during` — กด Ctrl-C ซ้ำครั้งที่สอง = force exit ไม่ค้าง
- `SELECT * FROM events WHERE kind IN ('spawn_fail','interrupted')` ใช้ query นับ/แยก
  class ได้จริง (manual check ตอน done — ไม่ต้องมี CLI ใหม่)
- `bun install` ไม่เพิ่ม package; `grep CREATE TABLE` ได้ 2 เท่าเดิม

## 4. Constraints / Hard rules (must not violate)

1. zero runtime dependency — resilience.ts ใช้ builtin เท่านั้น (SIGINT handler = `process.on`,
   builtin เช่นกัน)
2. ห้าม retry เมื่อ worktree มี commit ใหม่หรือ dirty เทียบจุดเริ่ม attempt → stalled
3. status enum เดิม 6 ค่า; event kinds เพิ่มได้ (เป็น data ไม่ใช่ schema)
4. ค่า config ทุกตัวผ่าน getters (db/getters.ts) + defaults รวมที่ db/defaults.ts —
   ห้าม hardcode ที่ call site
5. `assertSafe()` ต้องเรียกกับ cmd ทุก attempt — retry = spawn ใหม่ ต้องผ่าน deny-list ใหม่
6. SIGINT handler ต้องรับประกัน exit เสมอ — ครั้งแรก cleanup แล้ว exit, ครั้งที่สอง force
   exit ทันที ห้ามมี path ที่ Ctrl-C กด 2 ครั้งแล้ว process ยังไม่ตาย

## 5. Risks & Escape hatches (if it fails)

| risk | likelihood | impact | escape hatch |
|---|---|---|---|
| retry ยิง provider ซ้ำตอน limit ยังไม่ปล่อย = เผา token | กลาง | กลาง | limit-backoff เริ่ม 60s + ×2 cap 10 นาที + maxAttempts 3 — ถ้า event `spawn_fail` โชว์ว่ายังไม่พอ ค่อยทำ breaker (PLAN-2) |
| executor โดน kill กลางทางแล้ว commit ค้างใน worktree | ต่ำ | สูง | pre-spawn sha snapshot + clean-tree gate บล็อก retry → stalled (events มี commit hash อยู่แล้ว) |
| backoff sleep ยาวจน Ctrl-C ไม่ตอบสนอง | กลาง | กลาง | sleep แบ่งช่วงสั้น (≤1s) + เช็ค abort flag ทุกช่วง |
| child process (Bun.spawn) อยู่ process group เดียวกับ terminal → ได้ SIGINT จาก OS พร้อม parent (race กับ handler) | กลาง | กลาง | handler ฝั่ง parent แค่ log event + flush db (เร็ว, ไม่รอ child) แล้ว exit — ไม่ผูก cleanup กับผลลัพธ์ child |

## 6. Steps (what in which order)

1. **Pure core + unit tests** — `src/resilience.ts` (classify / backoff, ไม่แตะ process) +
   `test/resilience.test.ts` — verify: `fapony test` ผ่านตัวใหม่ครบ
2. **Log `spawn_fail`** ที่ spawn ทั้ง 2 จุด (classify จาก exitCode + timeout flag + tail) —
   verify: ทำให้ agent พังจริงแล้วมี event ใน db
3. **withRetry ฝั่ง role spawn** (`src/loop/spawn.ts`: gate/planner/bigFixer/scrutinizeFix) —
   retry เฉพาะ class ที่ policy อนุญาต — verify: fixture พัง 2 ครั้งแล้วสำเร็จ, auth ไม่ retry
4. **Executor retry + clean-tree gate** ใน run flow — verify: HEAD ขยับ/dirty → stalled ทันที
   ไม่ retry; สะอาด → retry ตาม policy
5. **SIGINT handler + `fapony stop` abort + event `interrupted`** — handler ใหม่ใน
   [fapony.ts](../../fapony.ts) (ครั้งแรก cleanup, ครั้งสอง force exit), `isAborted()` เช็ค
   status ระหว่าง backoff sleep — verify: Ctrl-C ระหว่างรอ backoff → exit ทันที, status
   `stopped`, event `interrupted` มีใน db พร้อม `during`; `fapony stop` จาก terminal อื่น
   ให้ผลเดียวกัน
6. **Docs + config ตัวอย่าง** — README, AGENTS.md (config schema + edge cases,
   ระบุชัดว่า breaker ไม่ได้ทำในรอบนี้), `fapony.config.json` — verify: `fapony test`
   ผ่านครบทั้งชุด

## 7. Examples (make it concrete)

- Config block, ตาราง policy ต่อ class, breaker state machine และลำดับเหตุการณ์เมื่อ
  agent ติด limit → อยู่ที่ [SPEC-resilience.md](../../spec/SPEC-resilience.md) ที่เดียว

## 8. References

- [src/run/spawn.ts](../../src/run/spawn.ts) — executor spawn (timeout → kill → exitCode)
- [src/run/flow.ts](../../src/run/flow.ts) — stalled path ที่ต้องกลายเป็น classify + retry
- [src/loop/spawn.ts](../../src/loop/spawn.ts) — role spawn (gate/planner/fixer) consumer ที่สอง
- [fapony.ts](../../fapony.ts) — CLI entry เดียว จุดที่ต้องเพิ่ม `process.on("SIGINT", ...)`
  (ตอนนี้ไม่มี signal handler ใดๆ ในโค้ดเลย — `grep -rn SIGINT src/` ว่างเปล่า)
- [src/stop.ts](../../src/stop.ts) — logic mark stopped + release memory ที่ SIGINT handler
  ต้องเรียกซ้ำ (ห้ามเขียน path ใหม่คู่ขนาน)
- [src/db/getters.ts](../../src/db/getters.ts) · [src/db/defaults.ts](../../src/db/defaults.ts) — รูปแบบ getter/defaults ที่ต้องตาม
- [src/safety.ts](../../src/safety.ts) — assertSafe ต้องผ่านทุก attempt
- [test/index.ts](../../test/index.ts) — runner ที่ต้องลงทะเบียน test ใหม่
- [spec/SPEC-resilience.md](../../spec/SPEC-resilience.md) — breaker design (§ Breaker) เก็บไว้
  ใช้ตอนทำ PLAN-2 เท่านั้น ไม่ใช่ scope ของ plan นี้
- กฎจาก [AGENTS.md](../../AGENTS.md) § Rules for AI Agents ข้อ 1 (ห้าม abstraction เดียว),
  § DB Schema (2 ตาราง), § Edge Cases แถว executor ค้าง
