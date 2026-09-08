# SPEC-verdict-stats — qualityScore + valueScore (read-time) + fapony_stats shape

> **Used by:** [PLAN-verdict-stats.md](../plan/PLAN-verdict-stats.md)
> งานนี้เปิด gate "value engine" ของ [SPEC-verdict-protocol.md](SPEC-verdict-protocol.md) —
> mapping ขึ้นโค้ดได้แล้ว **แต่ค่าห้ามเปลี่ยน** และทุกอย่างคำนวณ **ตอนอ่าน** (events read-only)

---

## Shape (data / API / schema)

### qualityScore — ขึ้นโค้ดที่ `src/parse.ts` (additive)

```ts
export function qualityScore(grade: VerdictGrade): number
```

ค่าล็อกจาก SPEC-verdict-protocol (ห้ามแก้ — additive-only เหมือน vocabulary):

| grade | pass-excellent | pass-good | pass-adequate | pass (legacy) | fail | uncertain |
|-------|---------------|-----------|---------------|---------------|------|-----------|
| score | 5 | 4 | 3 | 3 | 0 | 1 |

- `verdict` ใน event ยังเป็น **string ดิบ** เสมอ — score คำนวณตอนอ่าน ห้ามเขียนกลับ
- grade นอก set ไม่ควรเกิด (validate แล้วที่ parse/gate) — defensive: คืน 0

### Read-time join (ไม่มีการเขียน event)

ต่อ **gate event** `g` (มี `run_id`, `id`, data.verdict) — cost ต้องเป็น **per-round** (แค่ spawn
ของรอบนั้น) ไม่ใช่สะสมตั้งแต่ run เริ่ม เพื่อให้เทียบ avgCostUSD ข้าม grade ได้ apples-to-apples:

```
prevGateId = id ของ gate event ก่อนหน้าของ run เดียวกัน (สูงสุดที่ id < g.id), หรือ 0 ถ้าไม่มี
spawns  = kind='spawn' events ของ run เดียวกัน ที่ prevGateId < id < g.id (เรียงตาม id)
costUSD = sumSpawnCost(spawns).usd_estimate        // number | null — จาก src/cost.ts เท่านั้น
model   = data.model ของ spawn ล่าสุดใน spawns ที่ role='executor'   // null ถ้าไม่มี
valueScore = (costUSD !== null && costUSD > 0) ? qualityScore(verdict) / costUSD : null
```

- `costUSD <= 0` → valueScore = null กัน Infinity (zero-byte spawn = วัด value ไม่ได้ ไม่ใช่ value สูง)
- **ห้าม** `max(costUSD, 0.001)` — ทำให้ valueScore พุ่งปลอมเมื่อ cost เล็ก ขัดหลัก "never fake" ของ cost.ts
- pass-family เก็บ verdict ดิบ (เช่น `pass` → score 3 ตอนอ่าน) — **ไม่ normalize ใน data**
- gate ที่ model เป็น null (ไม่มี spawn, หรือ spawn ไม่มี `roles.executor.model` → `model: ""`)
  → **noted:** byModel รวมไว้ใน bucket `"(unknown)"` (gateCount นับ, avgCostUSD/avgValue เป็น null ตามจริง)
  — mcp-external runs ที่ไม่มี spawn ก็ตก bucket นี้

### StatsData — รูปทรงเดียว ใช้ทั้ง CLI และ MCP

```ts
interface StatsData {
  runs:    { total: number; byStatus: Record<string, number>;
             passRate: number; stallRate: number; avgRounds: number; avgMinutes: number };
  cost:    RunCost;                       // จาก sumSpawnCost ทั้ง db (bytes เสมอ, USD เมื่อ priced)
  stages:  { exec: { avg: number; count: number }; review: { avg: number; count: number } };
  byModel: Array<{ model: string; gateCount: number;
                   avgQuality: number; avgCostUSD: number | null; avgValue: number | null }>;
  byGrade: Array<{ grade: string; count: number; avgCostUSD: number | null }>;
  byWorktree: Array<{ worktree: string; runs: number; passed: number; stalled: number }>;
}
```

- `avgValue` = avg ของ valueScore ที่ **ไม่ใช่ null** เท่านั้น — ทุกตัว null → avgValue null
- ทุกช่อง null-prone (costUSD/avgValue) ต้องเป็น `null` ไม่ใช่ 0
- gate หลายรอบต่อ run (fail→pass) → **ทุก gate event นับแยกกัน** ใน byModel/byGrade (value ต่อรอบ)
  ส่วน passRate/stallRate ยังอิงระดับ run เหมือนเดิม

### MCP tool `fapony_stats`

```jsonc
// input
{ "json": true }        // optional, default false
// output (ToolResult.text)
json:true  → JSON.stringify(StatsData) ล้วน ห้ามแทรก text อื่น
json:false → text เดียวกับ `fapony stats` (CLI) — ใช้ formatter ตัวเดียวกัน
```

## Edge cases (input → expected)

| input | expected |
|-------|----------|
| pricing: null (default) | costUSD = null ทุก gate → valueScore = null, byGrade/byModel ช่อง USD/value = null — bytes ยังครบ |
| spawn bytes รวม = 0 | costUSD อาจเป็น 0 (priced) → valueScore = null (ไม่หารศูนย์) |
| gate จาก run "mcp-external" (ไม่มี spawn) | spawns 0 → costUSD/model/valueScore = null — ยังนับใน byGrade |
| run 2 รอบ (fail→pass) — round1 spawn cost $1, round2 spawn cost $2 | gate รอบ1 (fail) costUSD=$1; gate รอบ2 (pass) costUSD=$2 เท่านั้น (ไม่ใช่ $3 สะสม) — window ตัดที่ gate ก่อนหน้า |
| verdict `pass` (legacy) ปนกับ `pass-adequate` | score เท่ากัน (3) แต่ byGrade แสดง **แยกชื่อ** ห้าม merge |
| run กำลัง running ยังไม่มี gate event | ไม่เข้า byModel/byGrade — ยังนับใน runs.byStatus |
| custom legacy regex `pass|fail` | ยัง parse ได้ (shipped) — gate event ได้แค่ 2 grade นี้ สถิติไม่พัง |
| `fapony_stats` json:true | ต้องได้ JSON parse กลับได้ตรง StatsData — ห้าม prefix/suffix |
| tool name อื่น | errorResult `unknown tool` (เดิม) |

## Examples

**MCP verdict_submit หลัง parity:**

```jsonc
{ "name": "verdict_submit", "arguments":
  { "run_id": 7, "verdict": "pass-good", "reason_code": "none", "note": "test+typecheck ผ่าน" } }
// → { "stored": true, "run_id": 7, "verdict": "pass-good", ... }   // verdict เก็บดิบ
```

**Stats จาก gate events (ไม่มี pricing):**

```text
by grade:  pass-good×2 (avg —)  fail×1 (avg —)          // avgCostUSD = null → "—"
by model:  opencode/glm-4.6 ×3 gates  avgQuality 2.7  value —
```

## Spec amendments (บันทึกไว้ที่นี่ ที่เดียว)

- [SPEC-verdict-protocol.md](SPEC-verdict-protocol.md) §qualityScore — ถอนข้อ "ห้ามมีในโค้ด /
  value engine ไม่มี" → mapping ขึ้นโค้ดที่ src/parse.ts ด้วยค่าเดิมเป๊ะ + เพิ่มกติกา
  "คำนวณตอนอ่านเท่านั้น" เข้าไปแทน
- [SPEC-mcp-handcheck.md](SPEC-mcp-handcheck.md) §verdict_submit input — enum จาก
  `"pass" | "fail"` → 6 grades ครบ (ข้อความ required เปลี่ยนตาม)
