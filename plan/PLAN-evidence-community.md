# PLAN-evidence-community — P3 หลักฐานและชุมชน

> **Status:** 📝 draft — รอ kickoff (step 1–4 ทำได้ก่อน P2 จบ · step 5–7 ต้องรอ P2 gate) ·
> **Owner:** delamind · **Created:** 2026-09-08
> **Source spec:** [spec/SPEC-evidence-community.md](../spec/SPEC-evidence-community.md) — ล็อกใน step 1

---

## 1. เป้าหมาย (ทำไม)

เปลี่ยนข้อมูลจาก P2 (dogfood + baseline) ให้เป็น **หลักฐานสาธารณะที่ตรวจสอบได้**:
case study ที่มี methodology/sample size/ตัวเลขล้มเหลว, example adapter ≥2 แบบที่รันได้จริง,
practice doc สำหรับ developer ที่เป็น first user/verifier และการวัด repeat use/feedback
— เพื่อผ่าน P3 gate: คนนอกตัวเองกลับมาใช้ซ้ำหรือขอ comparison

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**
- example adapter/executor 2 แบบ (runnable) — smoke test กับ `fapony mcp` จริงได้
  ครบ flow collect → check → report
- practice doc — วงจร first user/verifier ที่คนอื่นลองตามบน repo ตัวเองได้ 1 รอบจบ
- case study — methodology + sample size ต่อ section + failure ระบุชื่อ + limitation,
  ตัวเลข reproducible จาก `fapony stats`/db จริง พร้อม snapshot date
- วัด repeat use / protocol completion จาก db ที่มีอยู่ (aggregate, read-only) +
  feedback channel แบบ GitHub issue template

**ไม่ทำ:**
- ไม่เริ่ม case study ก่อน P2 gate ผ่าน — ข้อมูลบาง = หลักฐานปลอม
- ไม่สร้าง telemetry ใหม่ / dashboard / ranking — ยังไม่มี demand (ROADMAP สนามที่ไม่เลือก)
- ไม่สรุป ranking จาก n<5 — แสดง `insufficient data` ตาม convention ของ report-web (ตอบ Q8 ชั่วคราว)
- ไม่ทำ adapter ครบทุก CLI tool — 2 แบบที่ใช้จริงพอ (กฎ #1: ห้าม abstraction เผื่ออนาคต)
- ไม่ให้ adapters กลายเป็น dependency ของ core — เป็นตัวอย่างใน `examples/` เท่านั้น

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- adapter 2 แบบรัน smoke test ผ่านกับ `fapony mcp` จริง (มีบันทึก version ของ CLI ที่ทดสอบ)
- practice doc ถูกใช้ทำตามจบ 1 รอบบน repo อื่น โดยไม่ต้องถามผู้เขียน
- case study มี methodology + sample size + ≥1 failure ที่ระบุชื่อ + limitation ครบทุก section
- วัด repeat use ได้จาก db (aggregate) + GitHub issue template สำหรับ feedback พร้อมใช้
- `bun test`, `bun run lint`, `bun run typecheck` ผ่าน (adapters มี test ของตัวเองเท่าที่จำเป็น)

## 4. ข้อจำกัด / กฎเหล็ก

- ตัวเลขทุกตัวใน case study ต้อง reproducible จาก `fapony stats` / db + ระบุวันที่ snapshot
- sample size rule: n<5 → `insufficient data` ห้ามสรุปเปรียบเทียบ (ล็อกชั่วคราวใน spec จนมี data)
- ห้าม publish plan content / commit message ส่วนตัว / secret — aggregate เท่านั้น
  (แนวเดียวกับ TELEMETRY.md)
- adapters import ได้เฉพาะของ public surface (`fapony mcp` ผ่าน stdio) — ห้าม import
  ไฟล์ภายใน `src/` ย้อนกลับ
- ทุกอย่าง build/read ได้จาก repo เดียว (MIT, public ตั้งแต่ commit แรก)

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| risk | likelihood | impact | escape hatch |
|---|---|---|---|
| P2 data ยังไม่พอถึงคิว case study | กลาง | สูง | ทำ adapter + practice ก่อน (ไม่ผูก data), เลื่อนเฉพาะ step 5–7 |
| adapter เปราะกับ flag ที่เปลี่ยนบ่อยของ CLI จริง | กลาง | ต่ำ | smoke test + ระบุ version ที่ทดสอบไว้ใน doc |
| case study ถูกอ่านเป็น marketing | กลาง | กลาง | บังคับมี failure + limitation ก่อน publish + ให้ scrutinize อ่านก่อน |
| ไม่มีคนนอกกลับมาใช้จริง | กลาง | สูง | P3 gate ไม่ผ่าน = ห้ามเริ่ม P6 — เก็บ feedback ต่อและวนกลับ P2 |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. **ล็อก spec** — sample-size rule, adapter contract (stdio flow + สิ่งที่ smoke test
   ต้องคลุม), outline ของ case study และ practice doc → **verify:**
   [spec/SPEC-evidence-community.md](../spec/SPEC-evidence-community.md) มีครบ 4 ส่วน + link กลับ
2. **adapter 1** — executor ที่ใช้ประจำ (เช่น claude CLI) เป็นตัวอย่างเต็ม → **verify:**
   smoke test ผ่าน collect → check → report กับ `fapony mcp` จริง
3. **adapter 2** — อีก tool ที่ใช้จริง (เช่น opencode) หรือ stub adapter สำหรับ CI →
   **verify:** smoke test ผ่านเช่นเดียวกัน
4. **practice doc** — เขียน docs + ลองทำตามเองบน repo อื่น 1 รอบ → **verify:** จบ flow
   ได้โดยไม่ติด, ช่องที่ติดแก้ใน doc ทันที
5. **เก็บ/ตรวจ dogfood data (gate: ต้องผ่าน P2 ก่อน)** — นับ n ต่อ section จาก db →
   **verify:** ทุก section รู้ว่า n เท่าไร และ section ไหน n<5 ติดป้าย insufficient data
6. **เขียน case study** — draft จาก db จริง + ให้ scrutinize อ่านก่อน publish →
   **verify:** มี failure + limitation + ตัวเลข reproducible ครบ
7. **publish + วัด** — ลง docs/ + โพสต์ช่องทางที่เลือก + เปิด feedback channel →
   **verify:** repeat-use query รันได้ + issue template อยู่ใน repo

## 7. ตัวอย่าง (เห็นภาพ)

โครง adapter, ตัวอย่าง smoke test และ outline ของ case study อยู่ใน
[spec/SPEC-evidence-community.md](../spec/SPEC-evidence-community.md) — ล็อกใน step 1
แล้ว section นี้ไม่ขยายตรงนี้

## 8. อ้างอิง

- [ROADMAP.md](../ROADMAP.md) §3 P3 + §6 Q8 — ที่มาของ scope และเงื่อนไข gate
- [plan/PLAN-first-user-loop.md](PLAN-first-user-loop.md) — แหล่ง dogfood data ที่ case study ใช้
- [docs/mcp-handcheck.md](../docs/mcp-handcheck.md) — protocol + adapter examples เดิมที่ step 2–3 ต่อยอด
- [src/mcp/tools/report.ts](../src/mcp/tools/report.ts) — verification_report ที่ adapter ต้องเรียกได้
- [TELEMETRY.md](../TELEMETRY.md) — เส้นแบ่ง aggregate vs content ที่ case study ต้องยึด
- [src/report-html.ts](../src/report-html.ts) — convention `insufficient data` ที่ step 5 ใช้ซ้ำ
