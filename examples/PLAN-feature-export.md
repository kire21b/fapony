# PLAN-feature-export — CSV/JSON export for data tables

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** [spec/export.md](../spec/export.md)

---

## 1. Goal (why)

User ต้อง copy data จาก table ใน UI ไป paste ใน Excel/Sheets ทุกครั้ง — เสียเวลา + ข้อมูล
หาย column บ้าง ต้องมี export button ที่ download ไฟล์ CSV หรือ JSON ตรงๆ

## 2. Scope (do / don't do)

**ทำ:**
- Export button บน data table component ( Tasks, Users, Projects tables)
- เลือก format: CSV หรือ JSON (dropdown เล็กๆ ข้าง button)
- Export ทั้งหมด (filtered rows) ไม่ใช่แค่ current page
- ตั้งชื่อไฟล์ตาม table name + timestamp (tasks-export-2026-09-05.csv)
- ใช้ browser download API (ไม่ต้อง backend)

**ไม่ทำ:**
- ไม่ทำ export ไป Google Sheets / Airtable — ทำ file download ก่อน
- ไม่ทำ scheduled export (cron) — manual click เท่านั้น
- ไม่ทำ export ทั้ง database — เฉพาะ table ที่ user กำลังดูอยู่
- ไม่ทำ custom column selection — export ทุก column ที่แสดงใน table

## 3. Done criteria (how we know it's finished)

- คลิก export → เลือก CSV → ไฟล์ download สำเร็จ
- ไฟล์ CSV เปิดใน Excel ได้โดยไม่ broken (comma-separated ถูก, quote escape ถูก)
- ไฟล์ JSON เปิดใน `jq` ได้ + valid JSON array
- ไฟล์ชื่อถูก format: `tasks-export-2026-09-05.csv`
- Filtered rows → export เฉพาะ filtered data (ไม่ใช่ทั้ง table)
- `npm run typecheck` ผ่าน

## 4. Constraints / Hard rules (must not violate)

- ห้ามส่ง data ไป server — ทุกอย่างเกิดใน browser (ไม่มี network request)
- ห้าม export ถ้า table ไม่มี data — ปิด button + show tooltip "No data to export"
- ห้ามใช้ third-party CSV library — เขียนเอง (fields ง่าย, ไม่ต้อง dependency)
- ห้าม export column ที่ user ไม่ได้เปิดแสดง — ตาม table column config

## 5. Risks & Escape hatches (if it fails)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| CSV format ผิด (comma ใน data ไม่ escape) | กลาง | Excel อ่านผิด | เขียน CSV escaper ที่ quote ทุก string field |
| Memory หมด (table ใหญ่ 10k+ rows) | ต่ำ | browser crash | stream ไม่ได้ → chunk download ถ้า rows > 5k |
| Unicode หาย (Thai chars, emoji) | กลาง | ไฟล์เปิดแล้วไม่เห็นตัวอักษร | prepend BOM สำหรับ CSV + charset=utf-8 |

## 6. Steps (what in which order)

1. **CSV export function** — toCSV(data, columns) ที่ return string · verify: unit test สร้าง CSV จาก sample data ได้ถูก
2. **JSON export function** — toJSON(data, columns) ที่ return string · verify: unit test + `JSON.parse` ได้
3. **Download trigger** — createDownload(content, filename) ใช้ Blob + URL.createObjectURL · verify: ไฟล์ download ได้จริง
4. **UI integration** — export dropdown button บน table component · verify: คลิกได้ + เลือก format ได้
5. **Edge cases** — empty data, filtered data, special chars · verify: test 3 ตัว pass

## 7. Examples (make it concrete)

```bash
# Manual test: export tasks table

# 1. Open tasks table in browser
open http://localhost:3000/tasks

# 2. Filter by status = "in-progress"
# 3. Click export → CSV
# → downloads tasks-export-2026-09-05.csv

# 4. Verify CSV
head -3 tasks-export-2026-09-05.csv
# id,title,status,assignee
# 1,"Fix login bug",in-progress,"@delamind"
# 2,"Add dark mode",in-progress,"@alice"

# 5. Verify JSON (export again → JSON)
cat tasks-export-2026-09-05.json | jq '.[0]'
# { "id": 1, "title": "Fix login bug", "status": "in-progress" }
```

## 8. References

- [spec/export.md](../spec/export.md) — column mapping + file naming rules
- [templates/PLAN.md](../templates/PLAN.md) — Plan Core template
- [skill/plan-with-me.md](../skill/plan-with-me.md) — วิธีสร้าง plan นี้
