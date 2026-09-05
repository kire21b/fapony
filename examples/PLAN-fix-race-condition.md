# PLAN-fix-race-condition — concurrent file write corruption

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** ไม่มี (bug fix — มี bug report เป็น spec อยู่แล้ว)

---

## 1. เป้าหมาย (ทำไม)

User รายงานว่า save ไฟล์พร้อมกัน 2 tabs ทำให้ไฟล์หายบางส่วน — เขียนทับกัน Race condition
ระหว่าง read-modify-write cycle ต้อง fix ให้ concurrent writes ไม่ corrupt ข้อมูล

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- เพิ่ม file lock mechanism (optimistic lock ด้วย file hash หรือ mtime check)
- ตรวจสอบ conflict ก่อน write — ถ้าไฟล์เปลี่ยนระหว่าง read กับ write → show warning
- Merge strategy: user เลือก keep mine / keep theirs / manual merge
- เพิ่ม error UI ที่แสดง conflict ชัดเจน

**ไม่ทำ:**
- ไม่ทำ CRDT-based real-time collaboration — overkill สำหรับ bug นี้
- ไม่ทำ auto-merge — ปล่อยให้ user ตัดสินใจ
- ไม่เปลี่ยน file format (ยังเป็น JSON เดิม)

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- เปิดไฟล์เดียวกันใน 2 browser tabs → แก้คนละส่วน → save tab 1 สำเร็จ → save tab 2 แสดง conflict warning
- เลือก "keep mine" → tab 2 ทับ tab 1 สำเร็จ + ไฟล์มี content ของ tab 2
- เลือก "keep theirs" → ไม่เกิดอะไร (ไฟล์ยังเป็นของ tab 1)
- ไม่มี conflict → save ทำงานปกติเหมือนเดิม
- `npm test` ผ่าน + มี test ใหม่ 2 ตัว: conflict detected, save after resolve

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- ห้าม lock file แล้วไม่ unlock — ต้องมี cleanup ทุก path รวมถึง error path
- ห้าม auto-merge — conflict ต้องให้ user เลือกเสมอ (ไม่งั้น data หายแบบไม่รู้ตัว)
- ห้ามแสดง raw hash ให้ user เห็น — ต้องเป็น "File was modified by another tab" ไม่ใช่ "Hash mismatch: abc123"
- ห้าม block UI ตอน checking conflict — ต้อง non-blocking (check on save, ไม่ใช่ on open)

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| Browser tabs ไม่ share lock state (different origins) | กลาง | lock ไม่ทำงาน | use file hash comparison แทน centralized lock |
| File changed by external tool (not another tab) | ต่ำ | false conflict | show "File modified externally" + offer reload |
| User ignores conflict แล้ว save ซ้ำ | ต่ำ | data หาย | auto-save conflict state + show banner จน resolve |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. **Add file hash tracking** — เก็บ SHA-256 ของไฟล์ตอน load · verify: hash คำนวณได้ถูกต้องจาก content
2. **Conflict check on save** — เปรียบเทียบ hash ตอน load กับ hash ปัจจุบัน · verify: test ที่ simulate concurrent write detect conflict
3. **Conflict resolution UI** — modal ที่แสดงทั้ง 2 versions + 3 buttons · verify: user เลือก option ได้ + ผลถูกต้อง
4. **Tests** — 2 test cases · verify: `npm test` pass

## 7. ตัวอย่าง (เห็นภาพ)

```bash
# Scenario: 2 tabs open same file

# Tab 1: load file → hash = "abc123"
# Tab 2: load file → hash = "abc123"

# Tab 1: edit + save → hash changes to "def456" → success

# Tab 2: edit + save → hash still "abc123" (stale)
# → conflict detected!
# → modal: "File was modified since you opened it"
#   [Keep Mine]  [Keep Theirs]  [Cancel]

# User clicks [Keep Mine]
# → file overwritten with tab 2 content
# → hash updated to tab 2's hash
```

## 8. อ้างอิง

- [templates/PLAN.md](../templates/PLAN.md) — Plan Core template
- [skill/plan-with-me.md](../skill/plan-with-me.md) — วิธีสร้าง plan นี้
