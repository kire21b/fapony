# SPEC-mcp-handcheck.md — MCP handcheck (3 tools)

> **Used by:** [PLAN-mcp-handcheck.md](../plan/PLAN-mcp-handcheck.md)

---

## Shape (data / API / schema)

### `reason_code` (enum, `verdict_submit` only)

ตัดสินแล้ว: enum ไม่ใช่ free text (ดู [ROADMAP.md](../ROADMAP.md) ข้อ 6.2) — index/query ได้ผ่าน
`fapony stats`, กันคำพ้องความหมายกระจาย (`"scope creep"` vs `"scope_creep"`)

```ts
type ReasonCode =
  | "missing_test"      // handoff อ้างว่า test ผ่านแต่ไม่มี test ใหม่ที่ครอบคลุม change
  | "scope_mismatch"    // diff ทำเกิน/ไม่ตรง plan ที่ตกลงไว้
  | "unsafe_command"     // handoff แสดงว่ามีคำสั่งที่ assertSafe() ควร block
  | "spec_gap"          // spec ไม่ครอบคลุม edge case ที่เจอ ไม่ใช่ความผิด executor
  | "other";            // ต้องมี note ประกอบเสมอเมื่อใช้ค่านี้
```

- ค่านี้เป็น**เดา cheap ตั้งต้น** จาก scope ของ [PLAN-mcp-handcheck.md](../plan/PLAN-mcp-handcheck.md) —
  ไม่ใช่ final list, ปรับตาม reason ที่เจอจริงตอน dogfood (step 6-7 ของ plan) ก่อน ship
- `note: string` (optional, required เมื่อ `reason_code === "other"`) — free text เสริม ไม่ใช่แทน enum
- เพิ่มค่าใหม่ได้ทีหลัง (append-only) — ห้ามเปลี่ยนความหมายค่าเดิม (กฎข้อ 4 ของ [PLAN-mcp-handcheck.md](../plan/PLAN-mcp-handcheck.md#4-ข้อห้าม-ห้ามละเมิด))

รายละเอียด schema เต็มของ 3 tools (`handoff_collect` / `handoff_check` / `verdict_submit`) —
รวมถึงว่า `verdict_submit` ผูกกับ `runs.id` ยังไงเมื่อ agent ภายนอกไม่เคยเรียก `fapony run` —
ยังไม่ปิด รอ step 1 เต็มของ plan (ไฟล์นี้เป็น skeleton ตอบแค่คำถาม reason_code ที่ค้างอยู่)

## Edge cases
(TODO — เติมตอนเขียน step 1 เต็ม)

## Examples
(TODO — เติมตอนเขียน step 1 เต็ม)
