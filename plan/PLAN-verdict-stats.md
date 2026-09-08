> ✅ **shipped** (9d2c4d3)

# PLAN-verdict-stats.md — MCP grade parity + fapony_stats (verify + measure + accumulate)

> **Status:** shipped · **Owner:** delamind · **Created:** 2026-09-08
> **Source spec:** [SPEC-verdict-stats.md](../spec/SPEC-verdict-stats.md)

---

## 1. Goal (why)

fapony-handcheck MCP server ตอนนี้ "ตรวจ" (handoff_collect/check, verdict_submit) ได้แต่ "วัด" ไม่ได้ —
grade 6 ระดับที่ core รองรับแล้ว (c298fef, 534ca3e) ยังเข้าไม่ถึงชั้น MCP และไม่มีทาง query สถิติที่
สะสมใน local state.db ผ่าน MCP ได้เลย เป้าคือปิดช่องนั้นให้ MCP ครบ verify + measure + accumulate

## 2. Scope (do / don't do)

**Do:**
- MCP `verdict_submit` รับ grade ครบ 6 ตัว (parity กับ core ที่ shipped แล้ว)
- คำนวณ qualityScore / costUSD / valueScore **ตอนอ่าน** ใน stats engine (ไม่แตะ event data)
- แยก `getStatsData()` ออกจาก `cmdStats()` + เพิ่ม breakdown by model / by grade / by value
- MCP tool ใหม่ `fapony_stats` (json / text)

**Don't do:**
- ไม่แก้ grade vocabulary / routing / DEFAULT_VERDICT_RE — shipped แล้วใน c298fef, 534ca3e
  (แก้ซ้ำ = เสี่ยง revert งานที่เข้าไปแล้ว)
- ไม่เขียน score/cost กลับลง event — SPEC-verdict-protocol ล็อกไว้ว่า verdict เก็บ string ดิบ
  และ cost เชื่อมผ่าน run_id + event id ไม่ต้อง copy ข้าม event (ต่างจาก draft เดิมที่ใช้
  patchLastGateEvent — ตัดทิ้งเพราะขัด spec ที่ shipped)
- ไม่ fake ตัวเลข — pricing: null → costUSD/valueScore = null (ห้าม max(cost, 0.001))
- ไม่ทำ model suggestion (Phase 5 เดิม) — รอ data จริง 20+ runs จึงมีแต้มต่อ
- ไม่เพิ่ม table / event kind / transport ใหม่

## 3. Done criteria (how we know it's finished)

- `bun test` ผ่านทั้งหมด — test เดิม (รวม legacy pass|fail regex) ไม่ต้องแก้
- `verdict_submit` รับ `pass-good` ได้ `{stored:true}` และปฏิเสธ `"ok"` ด้วย error ที่ list grade ครบ 6
- gate event data ยังเป็น `{verdict, note, round}` (+ reason_code/source จาก MCP) — ไม่มี field score แปะเพิ่ม
- `fapony stats` (CLI) แสดง by-model / by-grade / by-value ตาม spec; ไม่มี pricing → ช่อง value ว่าง ไม่ crash
- MCP `fapony_stats {json:true}` คืน JSON ตรง `StatsData` shape; `{json:false}` คืน text เดียวกับ CLI

## 4. Constraints / Hard rules (must not violate)

- **Vocabulary locked, additive-only** — ห้าม rename/remove grade เดิมในทุกจุดที่แตะ
- **qualityScore ใช้ค่าล็อกจาก SPEC-verdict-protocol เป๊ะ:** 5/4/3/3/0/1 (pass-excellent/pass-good/
  pass-adequate/pass/fail/uncertain) — ขึ้นโค้ดได้เพราะ spec ถูก amend แล้ว (step 1) แต่ห้ามเปลี่ยนค่า
- **events = read-only ในงานนี้** — ห้าม addEvent/patch ยกเว้นที่ MCP verdict_submit ทำอยู่แล้ว
- valueScore = `qualityScore / costUSD` เมื่อ costUSD เป็นจำนวน > 0 เท่านั้น — นอกนั้น null
- MCP ยัง stdio JSON-RPC + zero runtime dependency (bun:sqlite / node:* เท่านั้น)

## 5. Risks & Escape hatches (if it fails)

| risk | likelihood | impact | escape hatch |
|------|-----------|--------|--------------|
| pricing ไม่ตั้ง (ส่วนใหญ่ตอนนี้) → valueScore ว่างทั้ง db | สูง | ต่ำ | by-model ยังมี avgQuality + bytes; ช่อง USD/value แสดง "—" — ค่อยชวนตั้ง pricing ทีหลัง |
| MCP client cache schema เก่า (enum pass/fail) | กลาง | ต่ำ | tools/list คืน enum ใหม่ทุกครั้ง + error message บอก grade ที่ valid |
| getStatsData ช้าเมื่อ events บวม | กลาง | ต่ำ | ผ่าน events ครั้งเดียวต่อ call (sort run_id,id) เหมือน cmdStats เดิม — จำกัดขอบเขาเมื่อโตจริง |
| legacy `pass` ปนใน avg ทำเข้าใจผิด | ต่ำ | ต่ำ | by-grade แสดง `pass` แยกชื่อ ไม่ merge เข้า pass-adequate |

## 6. Steps (what in which order)

1. **Amend spec ก่อนแตะโค้ด** — SPEC-verdict-stats.md (shape ใหม่ทั้งหมด) + ถอนข้อ "ห้ามมีในโค้ด" /
   "value engine ไม่มี" ใน SPEC-verdict-protocol.md + อัปเดต enum ใน SPEC-mcp-handcheck.md
   → verify: 3 ไฟล์ link ถึงกันครบ ไม่มีประโยคค้างที่ขัดกับงานนี้
2. **`qualityScore()` ใน src/parse.ts (additive เท่านั้น)** + unit test ครบ 6 grade
   → verify: `bun test test/parse.test.ts` ผ่าน, test เดิมไม่แตก
3. **MCP verdict grade parity** — src/mcp/tools/verdict.ts ใช้ `VERDICT_GRADES.has()`,
   src/mcp/tools/index.ts enum `[...VERDICT_GRADES]`, อัปเดต description
   → verify: `bun test test/mcp/verdict.test.ts` (เพิ่ม case ทุก grade + invalid)
4. **`getStatsData()` + enrichment** — แยกจาก cmdStats, คำนวณ per-gate costUSD/model/valueScore
   แบบ read-time join, by-model/by-grade/by-worktree
   → verify: `bun test test/stats.test.ts` (ไฟล์ใหม่): no-pricing → null, zero-cost → null,
   multi-round run → gate ต่อรอบคิดต่างหาก
5. **MCP tool `fapony_stats`** — src/mcp/tools/stats.ts + register ใน tools/index.ts +
   case ใน transport.ts + test/mcp/stats.test.ts
   → verify: `bun test` ทั้งหมด + smoke ผ่าน stdio (`initialize`, `tools/list`, `tools/call`)

## 7. Examples (make it concrete)

รูปทรงข้อมูล, valueScore null-rules, StatsData, sample JSON-RPC → ทั้งหมดอยู่ที่
[SPEC-verdict-stats.md](../spec/SPEC-verdict-stats.md) — ใน plan นี้เก็บแค่ order + เงื่อนไขจบ

## 8. References

- Design ที่ bridge: [CLAUDE.md](../CLAUDE.md) § Verdict Protocol (grade vocabulary + qualityScore)
- Spec ที่ amend: [SPEC-verdict-protocol.md](../spec/SPEC-verdict-protocol.md) ·
  [SPEC-mcp-handcheck.md](../spec/SPEC-mcp-handcheck.md)
- Commits ที่ shipped ไปแล้ว: c298fef (6-grade grammar), 534ca3e (MCP→gateOnce routing)
- โค้ดที่เกี่ยว: [src/parse.ts](../src/parse.ts) · [src/gate.ts](../src/gate.ts) ·
  [src/cost.ts](../src/cost.ts) · [src/stats.ts](../src/stats.ts) ·
  [src/mcp/tools/verdict.ts](../src/mcp/tools/verdict.ts) · [src/db/store.ts](../src/db/store.ts)
- Plan ก่อนหน้าในสายงานเดียวกัน: plan/done/2026-09-08-PLAN-verdict-protocol.md
