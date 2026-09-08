> ✅ **shipped** (c298fef)

# PLAN-verdict-protocol — verdict แยก pass ออกจาก quality + vocabulary ล็อกเป็น benchmark scale

> **Status:** 🚧 draft · **Owner:** delamind · **Created:** 2026-09-08
> **Source spec:** [spec/SPEC-verdict-protocol.md](../../spec/SPEC-verdict-protocol.md)

---

## 1. เป้าหมาย (ทำไม)

ตอนนี้ verdict มีแค่ `pass|fail` — การวัด "งานดีแค่ไหน" กับ "แพงแค่ไหน" ไม่มีคำศัพท์กลางจึงเทียบ
กันไม่ได้แม้แต่ run กับ run ตัวเอง งานนี้ล็อก **vocabulary ที่เล็กที่สุดที่ยังตอบได้ว่า quality อยู่ตรงไหน**
(grade enum + evidence ต่อ grade + qualityScore mapping แบบ benchmark) แล้วบันทึก verdict ดิบลง
`events.data` — ให้การวัดค่าชัดเจนและสม่ำเสมอตั้งแต่ run ถัดไปเป็นต้นไป ข้อมูลเหล่านี้คือฐานพร้อมวิเคราะห์
เมื่อมี sample จริง **ไม่สร้าง engine ใดๆ ล่วงหน้า**

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**
- ขยาย verdict grammar: `pass-excellent | pass-good | pass-adequate | pass | fail | uncertain`
  (จุดเดียว — `DEFAULT_VERDICT_RE`), เก็บ **verdict string ดิบ** ลง gate event
- `gateOnce`/`cmdGate` รับ grade ทั้งชุด: pass-family → `passed` · `fail` → `fixing` ·
  `uncertain` → `stopped` + release memory (ทรงเดียวกับ round-cap path)
- ล็อก evidence ต่อ grade + qualityScore mapping ลง spec (documentation ล้วน ไม่ลงโค้ด)
- sync doc: `fapony.config.example.json`, comments, AGENTS.md config snippet

**ไม่ทำ (deferred — trigger ชัดจึงต้องมา):**
- ❌ valueScore / cost-quality engine — ยังไม่มี multi-model usage ให้ sample จริง
- ❌ `stats suggest` / `--json` / breakdown by model — ROADMAP P1 gate เขียนเองว่า "ห้ามทำจนมี sample"
- ❌ auto-switch model เมื่อ uncertain — ไม่มี infra ให้ switch และไม่ scaffold เผื่อ
- ❌ task category / plan-header tagging — ไม่มีคู่เปรียบเทียบให้ suggest ระหว่างกัน
- ❌ แก้ schema — grade อยู่ใน `events.data` JSON ที่มีอยู่แล้ว (2 ตารางผูกขาด)
- ❌ แก้ gate prompt บังคับ grade — pass/fail เก่ายังใช้ได้ (backward compat)

## 3. Done criteria (รู้ได้อย่างไรว่าเสร็จ)

- `bun test` (test/index.ts) เขียวครบ — test ใหม่เพิ่ม ของเดิมไม่พัง
- `fapony gate <id> pass-good "note"` ผ่านได้ (และทุก grade อีก 5 ตัว) — CLI usage แสดงรายชื่อ grade
- gate stdout `VERDICT: uncertain` → run `stopped`, event `stop` reason=`verdict_uncertain`,
  memory claim release — loop auto-gate กรณีนี้หยุดโดยไม่แก้ loop logic (drive ด้วย status อยู่แล้ว)
- config ใส่ markers.verdict เก่า `^VERDICT:\s*(pass|fail)\s*$` ยังทำงานได้ (`pass`/`fail` อยู่ใน set)
- spec มีตาราง grade + evidence ต่อ grade + qualityScore mapping — ปิดคำถามค้าง ROADMAP §6.4
  ("pass ขั้นต่ำต้องมี evidence อะไร")

## 4. ข้อห้าม (ห้ามละเมิด)

- **additive-only enum** — เพิ่ม grade ใหม่ได้ (เมื่อมีเหตุผลจริง) ห้ามเปลี่ยนความหมายค่าเดิม ไม่งั้น
  ข้อมูลเก่าวัดใหม่ไม่ได้ ทำลาย benchmark ตั้งแต่ฐาน
- **โค้ดห้ามตีความ quality** — gateOnce เห็นแค่ 3 กลุ่ม (pass-family / fail / uncertain) ตาราง
  qualityScore (5/4/3/0/1) เป็น doc อย่างเดียว
- schema คุม 2 ตารางเดิม
- ห้าม `git push` · ห้ามเขียนไฟล์ worktree เป้าหมาย · ทุก spawn ผ่าน `assertSafe()` เดิม

## 5. ความเสี่ยง & ทางหนี

| risk | likelihood | impact | escape hatch |
|------|-----------|--------|--------------|
| custom markers.verdict ของ config ผู้ใช้คืนค่านอก 6-grade set | ต่ำ | parse fail → null → fail-safe §0.4 | validate ด้วย set เสมอ — พฤติกรรมเดิม (ค้าง awaiting_review) ไม่เดาแทน |
| reviewer ของเดิมพ่นแค่ `VERDICT: pass` | สูง | วัด quality ละเอียดไม่ได้จนกว่า prompt จะอัปเกรด | pass/fail อยู่ใน enum — flow ไม่พัง, ไม่บังคับอัปเกรดพร้อมกัน |
| uncertain ยิงซ้ำรอบต่อรอบจาก reviewer | กลาง | loop หยุดบ่อย | uncertain = สัญญาณ plan มีปัญหา (เหมือน round-cap ตามกฎ #7) — stop event reason จะประจักษ์ใน stats ภายหลัง |
| cmdGate มือเรียก grade สะกดผิด | กลาง | exit 1 ทันที | usage string พิมพ์รายชื่อ grade ครบ — fail-safe ไม่เดาค่าใกล้เคียง |
| grade "ดี/ไม่ดี" ต่างกันข้าม reviewer (human + auto-gate) | กลาง | ข้อมูลเทียบกันไม่ได้ (ต้องเป็น benchmark) | evidence-checklist ต่อ grade ผูกอยู่ใน gate prompt contract — ล็อกใน step 0 ห้ามเลื่อนเกณฑ์ภายหลัง (additive-only) |

## 6. ขั้นตอน (เรียงลำดับ แต่ละขั้น verify ได้)

0. **ล็อก vocabulary** — grade enum 6 ตัว + evidence ต่อ grade + qualityScore mapping
   → verify: **[spec](../../spec/SPEC-verdict-protocol.md)** มีตารางครบทั้ง 6 พร้อม evidence, กฎ additive-only เขียนไว้
1. **parse layer** — `DEFAULT_VERDICT_RE` (alternation ยาวสุดนำหน้า) + `VerdictGrade` type +
   `parseGateVerdict` validate ด้วย set → verify: golden test — 6 grade ผ่านหมด / trailing text → null /
   legacy `pass`,`fail` ผ่าน / custom legacy regex คู่กับ set ใหม่ สลับกันยัง parse ออก
2. **gate layer** — `gateOnce(runId, verdict: VerdictGrade, note)`: pass-family → `passed`,
   `fail` → fixing + round cap (เดิม), `uncertain` → `stopped` + `stop` event reason=`verdict_uncertain`
   + release claim · `addEvent gate` เก็บ verdict ดิบ + round · `cmdGate` usage update
   → verify: test — uncertain stop path (status/event/memory) · gate event data เห็น `pass-good` ดิบ ·
   test ของ gate เดิม (cycle pass/fail) ไม่พัง
3. **loop doc touch** — hint text `pass|fail` ใน manual-review path ของ loop เปลี่ยนเป็นชื่อ grade
   → verify: hint ว่า `fapony gate <id> <grade> [note]` — ข้อความล้วน ไม่แตะ logic (loop drive ด้วย status)
4. **config example + AGENTS.md** — grade vocabulary + evidence contract ใน `fapony.config.example.json`
   + sync config schema snippet ใน [AGENTS.md](../../AGENTS.md)
   → verify: example config parse ได้ด้วย loadConfig + doc snippet ตรง regex จริงใน defaults
5. **dogfood 1 run จริง** — รัน gate บน wt-fapony ด้วย grade ใหม่ 1 อย่าง (เช่น pass-good)
   → verify: events เห็น gate event verdict ดิบ + `fapony handoff <id>` ไม่พัง
6. **ปิดจ็อบ** — `bun test` ครบ + lint/typecheck ตามที่ setup มี
   → verify: สีเขียวทั้งหมด

## 7. ตัวอย่าง (อยู่ใน spec)

ตาราง grade/evidence/mapping และตัวอย่าง CLI + event data อยู่ใน
[spec/SPEC-verdict-protocol.md](../../spec/SPEC-verdict-protocol.md) (step 0 ผลิต) — plan เก็บแค่ order

## 8. References

- [spec/SPEC-verdict-protocol.md](../../spec/SPEC-verdict-protocol.md) (step 0 ผลิต — grade grammar/evidence/mapping)
- [ROADMAP.md](../../ROADMAP.md) P0 "กำหนด verdict/failure reason ที่แยก pass ออกจาก quality" + §6.4 (evidence) + §6.2 (enum กัน typo กระจาย — free text เสริมเป็น note แยก)
- [src/parse.ts](../../src/parse.ts) `GateVerdict` + `parseGateVerdict` (จุด validate วันนี้เช็คแค่ pass/fail — ล็อก set ที่นี่)
- [src/gate.ts](../../src/gate.ts) `gateOnce`/`cmdGate` + round-cap stop path (ทรงที่ uncertain เลียนแบบ)
- [src/db/defaults.ts](../../src/db/defaults.ts) `DEFAULT_VERDICT_RE` (จุดล็อก vocabulary)
- [src/loop/index.ts](../../src/loop/index.ts) auto-gate drive ด้วย `gateOutcome.status` — uncertain ไหลผ่านถูกต้องโดยไม่ต้องแกะ loop
- [src/cost.ts](../../src/cost.ts) bytes/USD ต่อ spawn (machine facts ฐานของ benchmark มีอยู่แล้ว — นิยามใน metric dictionary ผูกกับ grade)
- [plan/done/2026-09-06-PLAN-cost-routing.md](2026-09-06-PLAN-cost-routing.md) (ต้นทางตัดสิน "bytes เป็น declared proxy")
