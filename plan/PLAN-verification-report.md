# PLAN-verification-report — รายงาน verify และ measurement อัตโนมัติ

> **Status:** 🔧 P0+P1 done · **Owner:** delamind · **Created:** 2026-09-08
> **Source spec:** [spec/SPEC-verification-report.md](../spec/SPEC-verification-report.md) ✅

---

## 1. เป้าหมาย (ทำไม)

ทำให้ agent เรียก fapony แล้วได้ **verification report** ที่อ่านได้ทันที โดยไม่บังคับให้
developer เปลี่ยน workflow หรือเรียก MCP หลาย tool เอง รายงานต้องรวม machine facts,
evidence, verdict, duration, rounds และ cost/usage พร้อม provenance เพื่อให้ developer
ตรวจงานและปรับปรุง agent/model/workflow จากข้อมูลจริงได้

งานนี้เป็นชั้นใช้งานด้านบนของของเดิม ไม่ใช่การเริ่ม MCP ใหม่ และยังไม่ประกาศตัวเป็น
มาตรฐานภายนอก

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- สร้าง report contract เดียวที่รวมผลจาก `handoff_collect`, `handoff_check`, verdict และ stats ที่มีอยู่แล้ว
- เพิ่ม high-level MCP entry point ชื่อ `verification_report` ให้ agent เรียกครั้งเดียวหลังทำงาน
- เพิ่ม evidence collection แบบ allowlist สำหรับ test, typecheck และ lint พร้อมสถานะ/เวลา/provenance
- แสดง duration, rounds, role/model และ usage/cost โดยแยก provider-reported value ออกจาก byte proxy/estimate
- ให้ report ออกได้ทั้ง human-readable text และ machine-readable JSON และเก็บ event ที่จำเป็นสำหรับ history
- dogfood กับ repo ที่ไม่ใช้ fapony loop เพื่อพิสูจน์ว่า agent ใช้ได้โดยไม่ต้องเปลี่ยน workflow หลัก

**ไม่ทำ:**
- ไม่ลบหรือแทนที่ MCP 4 tools เดิม — tools เดิมยังเป็น low-level/adapter surface และต้องทำงานเหมือนเดิม
- ไม่แก้ verdict vocabulary, qualityScore หรือ event schema ที่ shipped แล้ว เว้นแต่มีหลักฐานว่า contract ปัจจุบันใช้ไม่ได้
- ไม่เพิ่ม `plan_read`, `run_status`, `memory_query` และ tools อื่นเพียงเพราะเพิ่มไฟล์ได้ง่าย — ต้องมี use case จาก dogfood ก่อน
- ไม่ทำ public protocol, registry, cloud dashboard หรือ auto-routing ในแผนนี้ — ต้องพิสูจน์ usefulness และ data quality ก่อน
- ไม่เรียก byte count ว่า token usage จริง และไม่สร้าง cost จริงจากค่าประมาณ

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- Agent เรียก `verification_report` ครั้งเดียวแล้วได้ report ที่มี facts, evidence, verdict, duration, rounds และ usage/cost provenance
- Report เดียวกัน render ได้ทั้ง text สำหรับ developer และ JSON สำหรับ stats/CI โดยข้อมูลสำคัญไม่ขัดกัน
- Evidence command ทุกตัวมาจาก allowlist/config ที่ประกาศไว้ และผลลัพธ์แยก `passed`, `failed`, `not_run`, `unverified` ได้
- MCP tools เดิมและ CLI flow เดิมผ่าน regression tests โดยไม่เปลี่ยนความหมายของข้อมูลเก่า
- ทดลองกับ standalone repo ได้โดยไม่ต้องตั้งค่า fapony loop และได้ report ที่ developer อ่านแล้วรู้ next action
- `bun test`, `bun run lint` และ `bun run typecheck` ผ่าน

## 4. ข้อจำกัด / กฎเหล็ก

- **Compose ไม่ replace:** implementation ใหม่ต้อง reuse ผลและ logic ของ tools เดิม ไม่สร้าง parser/conformance logic ชุดที่สอง
- Facts ที่ fapony รันเองเท่านั้นจึงเป็น `verified`; input ที่ agent ส่งมาเองต้องติด `unverified` จน cross-reference สำเร็จ
- Evidence ต้องมี command identity, exit status, duration และ provenance; ห้ามเก็บ output เต็มที่อาจมี secret ลง state โดย default
- Provider token usage ที่ไม่มีจริงต้องแสดงเป็น `unavailable` หรือ `estimated`, ห้ามปัดเศษให้ดูเหมือนค่าจริง
- fapony ห้ามเขียนไฟล์ใน target worktree; report state อยู่ใน SQLite เดิมหรือ stdout เท่านั้น
- ข้อมูลเก่าใน `events.data` ต้องอ่านได้ และ field ใหม่ต้อง additive-only

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| risk | likelihood | impact | escape hatch |
|---|---|---|---|
| Agent ไม่เรียก report หลังทำงาน | สูง | ไม่มีข้อมูล measurement | เพิ่ม prompt/MCP description ที่ชัด และมี CLI fallback ที่สร้าง report จาก run ล่าสุด |
| Evidence command ใช้ไม่ได้ทุก repo | กลาง | report มี false failure | รองรับ `not_run` พร้อมเหตุผล และให้ project config กำหนด allowlist |
| token usage เป็นเพียง byte proxy | สูง | developer เข้าใจ cost ผิด | แสดง provenance/label ชัด และรองรับ provider-reported usage เมื่อมีจริง |
| high-level tool ทำ logic ซ้ำกับ 4 tools เดิม | กลาง | behavior drift | แยก orchestration ออกจาก primitive และเพิ่ม regression parity tests |
| evidence command รันนานหรือค้าง (test suite ใหญ่) | กลาง | agent รอ report นาน / timeout กลางทาง | กำหนด per-command timeout ใน spec + รายงาน `not_run`/timeout พร้อมเหตุผล ไม่ block ทั้ง report |
| report มีข้อมูลมากจน developer ไม่อ่าน | กลาง | ไม่เกิด adoption | กำหนด summary สั้น + expandable detail + next action ก่อนเพิ่ม metric |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. **[x] สำรวจและล็อก report contract** — ระบุ sections, status vocabulary, provenance และ backward-compatibility จาก output/tools เดิม → **done:** [spec/SPEC-verification-report.md](../spec/SPEC-verification-report.md) ล็อก contract + evidence vocabulary + provenance rules + edge cases + 3 ตัวอย่าง (pass/fail/standalone)
2. **[x] แยก shared verification primitives** — ให้ collect/check/evidence/report ใช้ parser และ result type ร่วมกัน โดยไม่เปลี่ยน behavior ของ MCP tools เดิม → **done:** `src/mcp/primitives.ts` (+ `CheckResult`, `EvidenceItem`, `EvidenceStatus`, `VerificationReport`, `computeEvidenceSummary`, `renderReportText`) + 9 tests ใน `test/mcp/primitives.test.ts` + barrel export → regression ผ่าน (test/lint/typecheck)
3. **เพิ่ม evidence collector** — รันเฉพาะ command ที่ allowlist และคืน structured result โดยไม่เก็บ secret output เต็ม → verify: test ผ่านกรณี pass, fail, timeout, not configured และ command ถูก block
4. **เพิ่ม `verification_report` MCP tool** — compose facts + handoff check + evidence + run metrics + verdict ให้เรียกครั้งเดียว → verify: stdio smoke test ได้ text/JSON ที่สอดคล้องกัน
5. **เพิ่ม report สำหรับ CLI/history** — ให้ developer ดู report ล่าสุดและ query report ย้อนหลังผ่านข้อมูลที่มีอยู่ โดยไม่สร้าง database table ใหม่ → verify: run จริงหนึ่งรอบเปิดดู report และ stats เดิมยังตรง
6. **dogfood และวัด adoption friction** — ทดลอง standalone repo และบันทึกจำนวนขั้นตอน, เวลาได้ report, report completeness และ next action → verify: agent จบ flow ได้โดยไม่ต้องถามผู้สร้าง และมีรายการ gap สำหรับรอบถัดไป
7. **ปิดจ็อบ** — อัปเดต README/docs พร้อมข้อจำกัดเรื่อง usage/cost และรัน test/lint/typecheck → verify: คำสั่งใน docs ตรงกับ implementation

## 7. ตัวอย่าง (เห็นภาพ)

```text
agent ทำงานตามปกติ → agent เรียก verification_report ครั้งเดียว → developer ได้ report
```

รายละเอียดของ response shape และ evidence command contract อยู่ใน
[spec/SPEC-verification-report.md](../spec/SPEC-verification-report.md) แล้ว

### ข้อตัดสินใจที่ทำแล้ว (จาก section 7 เดิม)

1. **Evidence allowlist อยู่ที่ไหน** → **ตัดสิน: แบบ (c) — ผสม**
   - Allowlist ใน `.fapony/evidence.json` ของ worktree (read-only, ไม่ขัดกฎ #5)
   - Agent ส่ง command เอง → ติด `unverified`
   - fapony รัน allowlisted command เอง → `verified`
   - ดู detail ใน SPEC §4

2. **Evidence timeout/concurrency** → **ตัดสินแล้ว**
   - Sequential (ไม่ parallel — ง่าย, deterministic)
   - Per-command timeout จาก `.fapony/evidence.json` (default 30s)
   - Total report timeout: 60s hard cap
   - Timeout → status `timeout`, ไม่ block คำสั่งอื่น
   - ดู detail ใน SPEC §5

## 8. อ้างอิง

- `src/mcp/tools/collect.ts` — machine facts ที่มีอยู่แล้ว
- `src/mcp/tools/check.ts` — handoff conformance ที่ต้อง reuse ไม่ duplicate
- `src/mcp/tools/verdict.ts` — verdict storage และ routing เดิม
- `src/mcp/tools/stats.ts` — read-time measurement ที่มีอยู่แล้ว
- `spec/SPEC-mcp-handcheck.md` — MCP 4-tool contract เดิม
- `docs/mcp-handcheck.md` — usage และ adapter examples
- `README.md` — user-facing MCP/CLI documentation
- `PHASE.md` / `ROADMAP.md` — verification and measurement direction (local planning docs)
