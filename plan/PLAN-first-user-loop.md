# PLAN-first-user-loop — P2 วงจรใช้งานจริงสำหรับผู้ทดลองคนแรก

> **Status:** 📝 draft — รอ kickoff · **Owner:** delamind · **Created:** 2026-09-08
> **Source spec:** [spec/SPEC-first-user-loop.md](../spec/SPEC-first-user-loop.md) — ล็อกใน step 1

---

## 1. เป้าหมาย (ทำไม)

ทำให้ loop ที่มีอยู่แล้ว (run → handoff → gate) ใช้เป็น **first user/verifier** ได้จริง:
plan/spec บอก intent กับเกณฑ์ตรวจก่อน spawn, handoff แยก facts/claims/risk ให้คนอ่าน,
review checklist สั้นพอใช้ทุกครั้ง และเริ่มเก็บ baseline + dogfood หลาย task category
เพื่อตอบด้วยข้อมูลว่า fapony ลด risk หรือ effort ตรงไหน (P2 gate ของ ROADMAP)

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**
- เพิ่ม header fields (`intent`, `task_category`, `acceptance`, `verification`) ให้
  templates/PLAN.md + SPEC.md แบบ optional-additive + planlint เตือนเมื่อ plan ใหม่ขาด
- ปรับ renderHandoff ให้หัวข้อชัด 3 ชั้น: **machine facts / agent claims / unresolved
  risk** — reuse ของเดิม (git facts นำหน้า + uncertain/not_done ติดป้ายชัด)
- gate checklist สั้น (≤7 ข้อ) สำหรับคน review — อยู่ใน docs + แสดงท้าย `fapony gate`
- baseline protocol: บันทึกตัวเลข pre-fapony (เวลา, rounds, escaped bug, review effort)
  แบบ manual doc — ไม่สร้างระบบเก็บใหม่
- dogfood ≥3 task categories (feature/bugfix/refactor) ผ่าน fapony loop เอง เก็บ pass/fail

**ไม่ทำ:**
- ไม่สร้าง `stats by-task` / `by-role` — ยังไม่มี sample (ROADMAP P1 ห้ามไว้ + กฎ #1)
- ไม่แก้ HANDOFF parse contract (fields เดิมคงเดิม — แค่ label การแสดงผล)
- ไม่ทำ inferred/auto tag — self-reported จาก plan header ก่อน (ตอบ ROADMAP Q5)
- ไม่สร้างตาราง escaped-bug tracking — ใช้ `task_category: bugfix` + link กลับ plan เดิม
  (ตอบ ROADMAP Q6 แบบเบา)
- ไม่แตะ telemetry payload หรือ MCP tools เดิม

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- templates มี header fields ใหม่ครบ + planlint เตือนเมื่อขาด (test ผ่าน, plan เก่าไม่ block)
- renderHandoff แสดง 3 ชั้นชัดเป็นหัวข้อ และ test เดิมแก้ตาม label ใหม่แล้วผ่าน
- `fapony gate` แสดง checklist ท้าย output; ใช้ checklist นี้ review จริง ≥1 run ได้
- docs baseline มีตัวเลข pre-fapony ≥3 งาน พร้อมวิธีวัดที่ทำซ้ำได้
- db มี run จริง ≥3 categories พร้อม verdict + `task_category` ใน plan header
- `bun test`, `bun run lint`, `bun run typecheck` ผ่าน

## 4. ข้อจำกัด / กฎเหล็ก

- ห้ามแก้ schema 2 ตาราง — metadata ทั้งหมดอยู่ใน plan header / `events.data` เท่านั้น
- additive-only ต่อ `ParsedHandoff` / `VerificationReport` (กฎ §0 ของ primitives)
- header fields ใหม่ = optional; ขาด → warn ไม่ block (`fapony run` ต้องรัน plan เก่าได้)
- ตัวเลข baseline/dogfood ต้องมาจาก db/`fapony stats` จริง ห้ามปรุง
- ห้ามเขียนไฟล์ใน worktree เป้าหมาย นอกจากผ่าน agent loop ปกติ

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| risk | likelihood | impact | escape hatch |
|---|---|---|---|
| planlint ผื่น plan เก่าทุกไฟล์จน noise | สูง | ต่ำ | warn เฉพาะ plan ที่แตะ/สร้างใหม่ (detected จาก marker) |
| checklist ยาวจนไม่มีใครอ่านจริง | กลาง | กลาง | cap 7 ข้อ + ทดลองใช้จริง 1 run แล้วตัดข้อที่ข้ามบ่อย |
| dogfood เผาเวลาเกินคุ้ม | กลาง | กลาง | เลือกงานจิ๋ว, cap เวลาต่องาน, หยุดได้ทุกงาน |
| ไม่มี baseline ก่อนใช้ fapony (สายเกิน) | สูง | กลาง | ยอมรับ baseline หลังแบบ retrospective + caveat ชัดใน case study (P3) |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. **ล็อก spec** — รูปแบบ header fields (enum ของ `task_category`/`verification`),
   checklist 7 ข้อ, baseline/dogfood protocol → **verify:** [spec/SPEC-first-user-loop.md](../spec/SPEC-first-user-loop.md)
   มีครบ 3 ส่วน + link กลับ plan นี้
2. **templates + planlint** — เพิ่ม fields ใน templates/PLAN.md + SPEC.md, planlint warn
   เมื่อ plan มี Source spec แล้วแต่ขาด fields → **verify:** test planlint ผ่าน + `fapony run`
   บน plan เก่ายังไม่ block
3. **handoff 3 ชั้น** — relabel renderHandoff (machine facts / agent claims / unresolved
   risk) + แก้ tests ให้ตรง → **verify:** `bun test` handoff ผ่าน + ตัวอย่าง output ใน spec
   ตรงกับของจริง
4. **gate checklist** — เขียน checklist ใน docs + แสดงท้าย `fapony gate` output →
   **verify:** `fapony gate` โชว์ครบ ≤7 ข้อ + ใช้ review จริง 1 run
5. **baseline** — บันทึกตัวเลข pre-fapony ≥3 งานลง docs → **verify:** มีตัวเลข + วิธีวัด
   ระบุชัดทุกงาน
6. **dogfood** — รันงานจริง ≥3 categories ผ่าน fapony loop → **verify:** db มี run + verdict
   ครบทุก category + สรุป pass/fail ต่อ category แนบใน plan นี้
7. **ปิดจ็อบ** — สรุปว่า data ตอบ P2 gate หรือไม่ + update checkbox ใน ROADMAP →
   **verify:** ROADMAP P2 ตรงกับข้อมูลใน db จริง

## 7. ตัวอย่าง (เห็นภาพ)

รูปแบบ plan header / checklist / ตัวอย่าง handoff output อยู่ใน
[spec/SPEC-first-user-loop.md](../spec/SPEC-first-user-loop.md) — ล็อกใน step 1 แล้ว
section นี้ไม่ขยายตรงนี้

## 8. อ้างอิง

- [ROADMAP.md](../ROADMAP.md) §3 P2 + §6 Q5/Q6 — ที่มาของ scope และคำถามที่ plan นี้ตอบ
- [src/handoff.ts](../src/handoff.ts) — renderHandoff/parseHandoff ที่ step 3 แตะ
- [src/planlint.ts](../src/planlint.ts) — checkPlanHygiene ที่ step 2 เพิ่ม warn
- [templates/PLAN.md](../templates/PLAN.md) + [templates/SPEC.md](../templates/SPEC.md) — ที่เพิ่ม fields
- [src/stats.ts](../src/stats.ts) — ตัวเลข baseline/dogfood ดึงจากที่นี่ ไม่สร้าง metric ใหม่
- [plan/PLAN-verification-report.md](PLAN-verification-report.md) — verification report ที่ handoff/report ใช้ต่อ
