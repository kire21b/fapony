# Plan Core — template สำหรับทุก plan file

> ใช้ template นี้กับทุก plan file (ไม่ใช่แค่ fapony) — ดู [CLAUDE.md](../CLAUDE.md) § Rules
> for AI Agents สำหรับกฎที่คุมว่า plan แต่ละไฟล์ต้องผ่านอะไรก่อนให้ agent ทำตาม

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
