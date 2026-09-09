# PLAN-central-benchmark.md — extend telemetry ด้วย ES/CPQ aggregate

> **Status:** ✅ done · **Owner:** delamind · **Created:** 2026-09-09
> **Amended:** 2026-09-09 — [PLAN-usage-depth.md](PLAN-usage-depth.md) ตัด benchmark framework (Phase B/C: `benchmark run/compare/export/serve`) และ metric 5 ตัว (TAR/TER/RLE/SBC/TDE) ทิ้งแล้ว — เหลือ Phase A (query extension) + ES/CPQ เท่านั้น
>   plan นี้เคยผูกทั้งก้อนไว้กับ Phase B/C ที่ไม่มีอยู่แล้ว จึงตัดชั้น 2 (`benchmark submit`) และชั้น 3
>   (`benchmark serve`) ทิ้งทั้งหมด — ไม่มีอะไรให้ submit/serve เพราะไม่มี benchmark run ให้ผลิต report แล้ว
> **Shipped:** 2026-09-09 — telemetry schema v3, derived namespace
> **Source spec:** extend telemetry pattern ที่มีอยู่แล้ว + ES/CPQ จาก [PLAN-usage-depth.md](PLAN-usage-depth.md) §3

---

## 1. เป้าหมาย (ทำไม)

`fapony telemetry` มี opt-in aggregate ส่งไป server ได้แล้ว (pass rate, cost, by-model) แต่ยังไม่มี
**ES/CPQ** (จาก [PLAN-usage-depth.md](PLAN-usage-depth.md) §3) เป็น aggregate field

งานนี้มีชั้นเดียว: **extend telemetry payload** — ตัวเลขล้วน ไม่ใช่ content เข้ากฎ telemetry เดิมได้พอดี
ไม่ต้องมี consent surface ใหม่

**ตัดออก (เคยอยู่ที่นี่ ยกเลิกเพราะ dependency หายไป):**
- **`fapony benchmark submit`** — เคยพึ่ง `fapony benchmark run/compare/export` จาก usage-depth Phase B
  ที่ถูกตัดทิ้งแล้ว (ไม่มี multi-agent variant ให้เทียบจริง) ไม่มี report ให้ submit จึงไม่มีเหตุผลให้มี
  คำสั่งนี้อยู่
- **`fapony benchmark serve`** — เคยอ้างอิง usage-depth Phase C (web server) ที่ตัดทิ้งแล้วเช่นกัน
- ถ้าวันหนึ่งมี benchmark framework จริง (มี multi-agent, มีคนขอ leaderboard) ค่อยเปิด plan ใหม่ตอนนั้น —
  ไม่ต้องเดาล่วงหน้าตอนนี้

---

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**
- Extend `machine` payload ใน telemetry (`schema_version` bump: 2 → 3, additive) ด้วย:
  - `tool_call_counts` (by tool name, ข้าม session) — จาก `part` table `type='tool'` (usage-depth Phase A)
  - `efficiency_scores` (ES ต่อ model) — `qualityScore(grade) / (costUSD × avgMinutes)`
  - `cost_per_quality` (CPQ ต่อ model) — `costUSD / qualityScore(grade)`
- ทุก field เป็น aggregate ตัวเลขล้วน ไม่มี content, อยู่ใต้ `derived` namespace
- ใช้ query จาก [PLAN-usage-depth.md](PLAN-usage-depth.md) Phase A ตรงๆ ไม่ implement ซ้ำ

**ไม่ทำ:**
- ไม่มี `benchmark submit`/`benchmark serve` (เหตุผลด้านบน)
- ไม่ทำ leaderboard UI/dashboard ฝั่ง server — repo นี้เป็นแค่ sender ฝั่ง client
- ไม่เดา schema ฝั่ง receiver — ตาม pattern telemetry เดิม (`schema_version` + reject unknown version)
- ไม่ผูกกับ `benchmark.json`/`benchmark_id` — ไม่มี object นั้นในระบบแล้ว

---

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- `fapony telemetry show` เห็น `tool_call_counts`, `efficiency_scores`, `cost_per_quality` ใน payload preview ก่อนส่งจริง
- TELEMETRY.md ยังคงยืนยันได้ 100% ว่า "telemetry เดิมไม่เคยส่ง content" (regression: field เดิมไม่เปลี่ยนความหมาย)
- **Regression สำคัญ:** ค่า `fapony_usage`/`fapony_stats` เดิม (total tokens/cost/session_count) ไม่เปลี่ยนแปลง — derived field ติด label `derived:` ใน JSON เสมอ
- `bun test` เขียว

---

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

### 4.1 Schema versioned เหมือน telemetry เดิม
- `schema_version`, additive-only, reject unknown version ฝั่ง receiver
- `tool_call_counts`/`efficiency_scores`/`cost_per_quality` อยู่ใต้ `derived` namespace — ห้ามปนกับ provider-reported field เดิม
- **ข้อมูลเดิมไม่เปลี่ยน:** `session.tokens_*`, `session.cost`, `session.session_count` ค่าเดิมทุกตัว

### 4.2 Privacy & Safety
- ห้าม fapony เขียนไฟล์ใน target worktree เพิ่มจากงานนี้ — payload สร้างจาก SQLite/stdout เดิม
- ยังคง redact worktree เป็น basename เหมือนเดิม
- Edge case: `costUSD=0` → ES=`null` (ไม่ใช่ Infinity), grade=fail → qualityScore=0 → CPQ=`null`

---

## 5. ความเสี่ยง & ทางหนี

| เสี่ยง | ทางหนี |
|---|---|
| derived metric คำนวณผิด (divider=0) | costUSD=0/qualityScore=0 → แสดงเป็น `null` ไม่ใช่ Infinity |
| tool-call aggregate ระบุตัวตนได้ทางอ้อม | redact worktree เป็น basename เหมือนเดิม, ไม่ผูก timestamp ละเอียดเกินจำเป็น |
| user สับสนว่า field ใหม่คือ provider-reported | `derived:` namespace ชัดเจนใน JSON + docs |

---

## 6. ขั้นตอน

1. **Pre-condition: [PLAN-usage-depth.md](PLAN-usage-depth.md) Phase A เสร็จก่อน** — ได้ `tool_call_counts` query + ES/CPQ formula ที่ผ่าน test แล้ว
2. **extend telemetry schema → v3** (`tool_call_counts`, `efficiency_scores`, `cost_per_quality`) → verify: `fapony telemetry show` เห็น field ใหม่, field เดิมค่าไม่เปลี่ยน, derived field ติด label
3. **เอกสาร** — TELEMETRY.md เพิ่ม 3 field ใหม่ในลิสต์ที่ส่งจริง
4. **`bun test`** → เขียว, regression ค่าเดิมไม่เปลี่ยน

---

## 7. ตัวอย่าง

```bash
fapony telemetry show
# {
#   "schema_version": 3,
#   "machine": {
#     "derived": {
#       "tool_call_counts": { "grep": 3400, "edit": 2100, "bash": 890 },
#       "efficiency_scores": { "claude-sonnet-4": 0.213 },
#       "cost_per_quality": { "claude-sonnet-4": 0.0113 }
#     }
#   }
# }
```

---

## 8. References

- [PLAN-usage-depth.md](PLAN-usage-depth.md) — Phase A query extension + ES/CPQ formula ที่ plan นี้ใช้ตรงๆ
- [TELEMETRY.md](../TELEMETRY.md) — กฎ "ไม่เคยส่ง content"
- [src/telemetry.ts](../src/telemetry.ts) — payload builder เดิมที่ต้อง extend แบบ additive (schema_version 2 → 3)
- [src/stats.ts](../src/stats.ts) — `getStatsData()`
- [src/session.ts](../src/session.ts) — `readPassiveUsage()` (usage-depth Phase A)
- [src/cost.ts](../src/cost.ts) — `sumSpawnCost()`, `estimateUsd()`
- [src/parse.ts](../src/parse.ts) — `qualityScore()`, `VERDICT_GRADES`
