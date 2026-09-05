# PLAN-readme-launch — README ใหม่ vendor-neutral + 3 use-case จริง

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** ไม่มี (ต่อยอดจาก [ROADMAP.md](../ROADMAP.md) § เดือนที่ 3)

---

## 1. เป้าหมาย (ทำไม)

README ปัจจุบันอธิบาย fapony เป็น "CLI orchestrator สำหรับ opencode" — เขียนจากมุม
implementation ไม่ใช่มุมคนอ่านครั้งแรก ทำให้พลาด pitch จริง: fapony ทำให้ coding agent
ตัวไหนก็ได้ (Claude Code / OpenCode / Codex) กลายเป็น multi-agent workflow ได้โดยไม่ต้อง
ผูกกับ vendor เดียว งานนี้เขียน README ใหม่ + ตัวอย่างจริง 3 case ตาม 3 agent ให้คนอ่านเห็น
ภาพว่าใช้กับเครื่องมือของตัวเองยังไงโดยไม่ต้องอ่านโค้ดก่อน

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- เขียน README.md ใหม่ ย่อหน้าแรกเป็น pitch เดียว ("fapony ทำให้ทุก coding agent เป็น
  multi-agent workflow ได้") ไม่ใช่ architecture summary
- 3 case study ตาม ROADMAP เดือนที่ 3 พอดี: Claude Code (`fapony kickoff` + reviewer gate),
  OpenCode (fapony + mem.ts memory), Codex (fapony + spec/ เป็น contract)
- แต่ละ case มีคำสั่งรันจริงที่ copy-paste ได้ (ไม่ pseudo-code)
- ลิงก์จาก README ไปยัง examples/, prompts/plan-with-me.md ที่มีอยู่แล้ว (จาก
  [PLAN-plan-with-me.md](done/PLAN-plan-with-me.md))

**ไม่ทำ:**
- ไม่เขียน landing page หรือเว็บไซต์แยก — README เดียวพอสำหรับเปิดตัว ไม่ใช่ product launch
  เต็มรูปแบบ (ยังไม่มี user ภายนอกจริง)
- ไม่ทดสอบ fapony กับ Codex จริง (ไม่มี Codex ในมือตอนนี้) — เขียน case จากสิ่งที่
  spec injection ทำได้จริงแล้ว (verified ใน PLAN-init-scaffold) ไม่ใช่ demo สด
- ไม่รื้อ CLAUDE.md — คนละ audience (README = คนอ่านครั้งแรก, CLAUDE.md = agent ที่ทำงานต่อ)

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- README.md ย่อหน้าแรกพูดถึง "ทุก coding agent" ไม่ผูก opencode อย่างเดียว
- มี 3 case study ครบทั้ง Claude Code / OpenCode / Codex พร้อมคำสั่งรันจริง
- ทุกลิงก์ใน README เปิดได้จริง (ไม่ 404) — เช็คด้วย script เดียวกับที่ใช้ตอน plan-mv
- อ่าน README จบแล้วตอบได้ว่า "ต้องรันคำสั่งอะไรก่อน" โดยไม่ต้องเปิด CLAUDE.md

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- ห้ามอ้างว่า test กับ Codex จริงถ้าไม่ได้ทำ — เขียนให้ชัดว่าเป็น "ตัวอย่างท่าที่รองรับ"
  ไม่ใช่ "ทดสอบแล้ว" (กันโกหกผู้ใช้)
- ห้าม duplicate เนื้อหากับ CLAUDE.md — README ลิงก์กลับไป CLAUDE.md สำหรับรายละเอียด
  ไม่ copy schema/flow มาซ้ำ
- คำสั่งทุกอันใน case study ต้องตรงกับ CLI จริงใน `fapony.ts` ตอนเขียน (เช็คคู่กับ
  `fapony test` ก่อน commit)

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| Case study Codex เขียนแล้วไม่ตรงจริง (ไม่มี Codex ทดสอบ) | กลาง | สอนคนผิด | ระบุชัดว่าเป็น "รองรับตาม design" ไม่ใช่ "ทดสอบแล้ว" |
| README ยาวเกิน คนอ่านไม่ครบ | กลาง | pitch ไม่ถึง | pitch + 3 case อยู่บนสุด รายละเอียดลึกลิงก์ออกไป CLAUDE.md |
| ลิงก์ broken หลัง merge | ต่ำ | ประสบการณ์แย่ | รัน link-check script ก่อน commit |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. เขียน pitch ย่อหน้าแรกใหม่ (vendor-neutral) — verify: อ่านแล้วไม่มีคำว่า "opencode"
   ในย่อหน้าแรก
2. Case 1: Claude Code + reviewer gate ผ่าน `fapony kickoff` — verify: คำสั่งรันจริงได้กับ
   fixture ใน test/fixtures/
3. Case 2: OpenCode + memory ผ่าน mem.ts — verify: อ้างอิง config.memory schema ตรงกับ
   CLAUDE.md จริง
4. Case 3: Codex + spec-driven ผ่าน `.fapony/spec/` — verify: อ้างอิง spec injection
   behavior ตรงกับที่ src/run.ts ทำจริง (ไม่ใช่เดา)
5. รัน link-check ทุกลิงก์ใน README ใหม่ — verify: ไม่มี broken link

## 7. ตัวอย่าง (เห็นภาพ)

```bash
# ก่อน (README เดิม)
"fapony = CLI orchestrator สำหรับ multi-agent dev loop: opencode เขียน → review → วนต่อ"

# หลัง (README ใหม่)
"fapony ทำให้ coding agent ที่คุณใช้อยู่แล้ว (Claude Code / OpenCode / Codex)
กลายเป็น multi-agent workflow ได้ โดยไม่ต้องเรียน framework ใหม่"
```

## 8. อ้างอิง

- [ROADMAP.md](../ROADMAP.md) — เดือนที่ 3
- [plan/done/PLAN-plan-with-me.md](done/PLAN-plan-with-me.md) — examples/ ที่มีอยู่แล้วให้ลิงก์ไป
- [plan/done/PLAN-init-scaffold.md](done/PLAN-init-scaffold.md) — spec injection behavior ที่ case 3 อ้างอิง
- [CLAUDE.md](../CLAUDE.md) — Plan Core template, CLI Commands
