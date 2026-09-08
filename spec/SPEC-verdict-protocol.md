# SPEC-verdict-protocol — grade vocabulary + evidence + qualityScore mapping

> **Used by:** [PLAN-verdict-protocol.md](../plan/PLAN-verdict-protocol.md)
> งานนี้ล็อก **vocabulary ให้ชัดและอยู่กับที่** ก่อนแตะโค้ด — ค่าที่ใช้วัดห้ามเปลี่ยนความหมายกลางทาง
> (additive-only) ไม่งั้นเทียบข้าม run ไม่ได้ = benchmark พังตั้งแต่ฐาน

---

## Shape (vocabulary / grammar)

**VerdictGrade** (locked — ใน regex ให้ alternation ยาวสุดนำหน้า):

```
pass-excellent | pass-good | pass-adequate | pass | fail | uncertain
```

- **Regex** (`DEFAULT_VERDICT_RE` ใน [src/db/defaults.ts](../src/db/defaults.ts) — จุดเดียวที่ล็อก):
  `^VERDICT:\s*(pass-excellent|pass-good|pass-adequate|pass|fail|uncertain)\s*$` — flag `"m"` เดิม
- **Type** (อยู่คู่ `GateVerdict` ใน [src/parse.ts](../src/parse.ts)):
  `type VerdictGrade = "pass-excellent" | "pass-good" | "pass-adequate" | "pass" | "fail" | "uncertain"`
  — parse ห้ามใช้ regex match อย่างเดียว ต้อง validate กับ set นี้เสมอ (กัน custom regex คืนขยะ)
- **Evolution rule:** เพิ่ม grade ใหม่เข้า set ได้เมื่อมีเหตุผลจริง — ห้ามเปลี่ยน/ลบความหมายค่าเดิม

## Grade semantics — ความหมาย + evidence ที่ต้องมี

ตารางนี้คือ **contract ของ reviewer** (ลง gate prompt + `fapony.config.example.json`) —
grade โดยไม่มี evidence ครบตามตาราง = ไม่ถือ grade นั้น:

| grade | ความหมาย | evidence ต้องมี (ตรวจได้ ไม่ใช่เชื่อคำ) | status ที่ได้ |
|-------|----------|------------------------------------------|----------------|
| `pass-excellent` | เกิน expectations, ตรวจละเอียด | test ผ่าน + typecheck ผ่าน + reviewer ยืนยัน edge cases ที่ลองแล้ว | `passed` |
| `pass-good` | สมบูรณ์ ดี minor risks | test ผ่าน + typecheck ผ่าน | `passed` |
| `pass-adequate` | ผ่านเกณฑ์ต่ำสุด — residual risk ต้องระบุใน note | test ผ่าน | `passed` |
| `pass` (legacy) | "มันทำงานได้" — คงไว้, ไม่แตะ prompt เก่า | — | `passed` |
| `fail` | ต้องแก้ — note = สิ่งที่ gate เจอ เอาไปเป็น fixer input | สิ่งที่ fail ระบุชัดต่อรอบถัดไป | `fixing` (round cap เดิม) |
| `uncertain` | ตัดสิน quality ไม่ได้ (evidence ขาด / handoff ขาด) | reviewer ระบุใน note ว่าอะไรขาด | `stopped` |

## qualityScore mapping — doc ล้วน (metric dictionary)

**ห้ามมีในโค้ด** — ใช้ตอนมี sample จริงเท่านั้น:

```
pass-excellent = 5 · pass-good = 4 · pass-adequate = 3 · pass = 3 · fail = 0 · uncertain = 1
```

- นี่คือสเกล benchmark ที่ล็อกไว้ล่วงหน้า — reviewer ต่างเจ้าก็แปลงด้วยตารางเดียวกัน
- ความประณีตระดับรายละเอียดไปที่ `note` เสมอ (ตามหลักเดิม ROADMAP §6.2: enum กัน typo, free text แยกเป็น note)
- **value engine ไม่มี** — trigger: multi-model usage จริง + sample พอ จึงสร้างตาม ROADMAP P1 gate

## Gate event data shape (ลง `events.data`, kind=`gate`)

```json
{ "verdict": "pass-good", "note": "...", "round": 1 }
```

- `verdict` = **string ดิบที่ gate พ่น** — ไม่ normalize, ไม่แปะ score ลงใน data
- `round` — เพิ่มจากเดิม (gateOnce มีค่า run row ตอนเขียนอยู่แล้ว) = เห็น grade ต่อรอบใน audit trail
- cost ไม่ซ้ำสองที่: ทุก spawn มี kind=`spawn` อยู่แล้ว (`role, model, bytes_in/out, usd_estimate?` —
  [src/cost.ts](../src/cost.ts)) — grade กับ cost เชื่อมกันด้วย run_id + round ทั้งคู่ ไม่ต้อง copy ข้าม event

## ผลต่อสถานะ (ครอบทั้ง `gateOnce`)

| verdict | gateOnce ทำอะไร |
|---------|------------------|
| pass-family (4 ตัว) | setStatus `passed` + gate event ดิบ + memory close + kickoff (เดิมทุกอย่าง) |
| fail | incrementRound + `fixing` + round cap check (เดิมทุกอย่าง) |
| uncertain | `stopped` + `stop` event reason=`verdict_uncertain` + memory release — ทรงเดียวกับ round-cap path; loop ไม่ต้องแก้ logic (drive ด้วย passed/fixing/stopped อยู่แล้ว) |

## Edge cases (input → expected)

| input | expected |
|-------|----------|
| `VERDICT: pass-good` ท้าย stdout | parsed = `pass-good`, note = ทุกอย่างหลัง marker (trim) |
| `VERDICT: pass-adequate` แต่ user ใช้ custom legacy regex เก่า | parse fail → null → fail-safe §0.4 (ค้าง `awaiting_review`) — ไม่ error ทั้ง run |
| `VERDICT: passsomething` | ไม่อยู่ใน set → null → fail-safe |
| `VERDICT: pass-good ดีมาก` (text แทรกในบรรทัดเดียว) | regex `\s*$` ไม่ match → null → fail-safe — ห้ามยืดเกณฑ์ให้ match หลุดๆ |
| cmdGate `fapony gate <id> uncertain "..."` | stop path สร้างจาก CLI โดยตรง (ไม่ต้องมี VERDICT line) |
| custom markers.verdict เก่า `^VERDICT:\s*(pass|fail)\s*$` | ยังทำงาน — เห็นแค่ pass/fail (ยังอยู่ใน set) จนกว่าผู้ใช้จะเปลี่ยน regex เอง |
| gate exit 0 แต่ไม่มี VERDICT เลย | เดิม → `awaiting_review` (§0.4) |

## Examples

**CLI:**

```bash
fapony gate 3 pass-good "test+typecheck ผ่าน ตาม handoff"                         # → passed
fapony gate 3 fail "files=22 > threshold 15 แต่ route เห็น small — ไล่อะไรผิด"    # → fixing (round +1)
fapony gate 3 uncertain "handoff ขาดหมวด checks — ตรวจต่อไม่ได้"                  # → stopped
```

**Before / after ของ gate event:**

```text
before: {"verdict":"pass","note":"..."}                   # เทียบคุณภาพข้าม run ไม่ได้
after:  {"verdict":"pass-good","note":"...","round":1}    # string ดิบ + รอบ — ฐานพร้อม aggregate ภายหลัง
```

## Sample-size rule (เก็บไว้ที่นี่ที่เดียว)

- แม้ตารางข้างบน ก็ห้ามตีความเป็น "อัตรา" จนกว่า dogfood จะสะสม run จริงต่อ grade พอ —
  ตอนนั้นให้ `fapony stats` แสดง count ดิบก่อน แล้วจึงตั้ง threshold จาก data จริง (ไม่เดาล่วงหน้า)
- **claim / machine-fact แยกกันเสมอ:** grade รวมถึง bytes = claim ของ reviewer;
  bytes/USD จาก kind=`spawn` = machine fact — ห้ามผสมเป็น score เดียวกระทบกัน ตัดสินแบบ statistical
  จะทำเมื่อมี sample และ sample-size rule ล็อกแล้วเท่านั้น
