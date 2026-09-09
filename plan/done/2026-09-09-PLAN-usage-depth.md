# PLAN-usage-depth.md — วัดลึกขึ้น: tool calls + step breakdown, ES/CPQ

> **Status:** ✅ done · **Owner:** delamind · **Created:** 2026-09-09
> **Amended:** 2026-09-09 — ตัด benchmark framework/export/web server ออก (speculative, ยังไม่มี evidence ว่าจำเป็น) เหลือแค่ extend query + 2 metric
> **Shipped:** 2026-09-09 — b87ca21, 4fd89d4
> **Source spec:** data สำรวจแล้วจาก opencode.db ทั้งหมด (ดู §5)

---

## 1. เป้าหมาย (ทำไม)

`fapony_usage` วันนี้บอกได้แค่ "model นี้ใช้ token/cost รวมเท่าไหร่ต่อ session" — ไม่พอสำหรับ:
- **model นี้ทำงานยังไง** (เรียก tool อะไรกี่ครั้ง, กี่ step ถึงจบ)
- **คุ้มไหม** (คุณภาพ vs cost)

ข่าวดี: OpenCode เก็บข้อมูลนี้อยู่แล้วใน `part` table (tool calls, step-finish token breakdown ต่อ step) —
**ไม่ต้องเพิ่ม instrumentation ใหม่** แค่ query ลึกขึ้น

**ไม่ทำตอนนี้ (YAGNI จนกว่าจะมี evidence):**
- Benchmark harness ข้าม model/agent (`fapony benchmark run/compare/serve`) — ยังไม่มี multi-agent จริงใน
  `executor.cmd` (ผูก opencode ตัวเดียว) จะเทียบ variant ที่ยังไม่มีให้เทียบไปทำไม ถ้าอยากเทียบ model วันนี้
  ตั้ง `session.title` เองตอนรัน แล้ว query ด้วยมือ — ไม่ต้องมี subcommand
- Export txt/JSON report format, web server, public display — ไม่มีใครขอ, เพิ่ม attack surface
  (localhost server, public bundle) ก่อนรู้ด้วยซ้ำว่ามีคนใช้ metric พื้นฐานจริง
- TAR/TER/RLE/SBC/TDE — 5 metric ที่ยังไม่เคยรันกับข้อมูลจริง ไม่รู้ว่าตัวไหนมีความหมาย ส่งพร้อมกันมีแต่จะ
  ยาวจนอ่านไม่ไหว (ปัญหาเดียวกับที่ `fapony_usage` เดิมมีอยู่แล้ว) — ถ้า ES/CPQ ไม่พอค่อยเพิ่มทีละตัว

---

## 2. Data Source (สำรวจ 2026-09-09)

### 2.1 OpenCode DB (`~/.local/share/opencode/opencode.db`) — ReadOnly

**`session` table** (provider-reported):
```
s.id, s.project_id, s.model, s.time_created, s.time_completed,
s.tokens_input, s.tokens_output, s.tokens_reasoning,
s.tokens_cache_read, s.tokens_cache_write, s.cost, s.title
```

**`part` table** (derived from agent turns):
```
p.id, p.message_id, p.session_id, p.type, p.data, p.time
```
- `type='tool'`: `{"type":"tool","tool":"grep","state":{"status":"completed","time":{"start":...,"end":...}}}`
- `type='step-finish'`: `{"type":"step-finish","tokens":{"total":19679,...},"cost":0}`

**ข้อมูลจริงที่สำรวจ:** 66k+ tool parts ในเครื่องเดียว → query ต้อง aggregate ใน SQL ไม่ดึง raw มา loop

### 2.2 Fapony State DB (`~/.config/fapony/state.db`)

**`runs`**: `id, worktree, plan, mem_id, status, base_sha, round, created_at, updated_at`
**`events`**: `kind='spawn'` → `{role, model, bytes_in, bytes_out, usd_estimate}`, `kind='gate'` → `{verdict, note, round}`

### 2.3 Config — pricing

`pricing.<role>.{inputPer1k,outputPer1k}`, `pricing:null` = ปิด USD estimate

---

## 3. Derived Metrics — เอาแค่ 2 ตัวที่ตอบคำถาม "คุ้มไหม"

### 3.1 Efficiency Score (ES)

```
ES = qualityScore(grade) / (costUSD × avgMinutes)
```
- `qualityScore`: pass-excellent=5, pass-good=4, pass-adequate=3, pass=3, fail=0, uncertain=1
- `costUSD`: จาก `sumSpawnCost(events)` (ทุกรอบ)
- `avgMinutes`: จาก `(updated_at - created_at)` ของ run
- ถ้า `costUSD=0` (ไม่มี pricing) → ES ใช้ `bytes_in + bytes_out` เป็น proxy แทน

**ตีความ:** ES สูง = คุณภาพดี/ต้นทุนต่ำ/เร็ว = คุ้มที่สุด

### 3.2 Cost Per Quality Point (CPQ)

```
CPQ = costUSD / qualityScore(grade)
```
- grade=0 (fail) → `Infinity`

**ตีความ:** CPQ ต่ำ = จ่ายน้อยได้คะแนนสูง = คุ้ม

Tool-call count และ step count เก็บเป็น **raw breakdown** (ไม่ปั้นเป็นสูตร TAR/TDE) — โชว์
`{tool_name: count}` และ `steps` ตรงๆ ให้คนอ่านตีความเอง ถ้าพบว่าอยากได้ ratio จริงค่อยเพิ่ม metric
ทีหลังตอนรู้แล้วว่ามันตอบคำถามอะไร

---

## 4. Implementation Steps

**A1. Extend `readPassiveUsage()` → เพิ่ม `detail: boolean` param**
- Query `part` table: tool-call breakdown ต่อ session (`GROUP BY json_extract(data, '$.tool')`)
- Query `part` table: step count + token sum ต่อ session
- Cross-check: sum ของ step tokens ต้องตรงกับ `session.tokens_*` (หรืออธิบายส่วนต่างได้)
- **Verify:** unit test เทียบผลกับ raw SQL บน fixture DB

**A2. เพิ่ม ES/CPQ ใน `getStatsData()`**
- คำนวณจาก grade + spawn cost + run duration ที่มีอยู่แล้ว
- ติด label `derived:` ใน output — ห้ามปนกับ provider-reported
- **Verify:** `fapony stats` แสดง ES/CPQ ไม่ชนกับ field เดิม

**A3. `fapony_usage` MCP tool — เพิ่ม `detail: true`**
- คืน `tool_breakdown: {tool_name: count}` + `steps` ต่อ session เมื่อขอ detail
- default (ไม่ขอ detail) = พฤติกรรมเดิมเป๊ะ (regression: total tokens/cost เท่าเดิม)
- **Verify:** cross-check กับ `sqlite3 opencode.db` query ตรงๆ

**Tests:** ต่อ suite ที่มีอยู่ (ไม่ต้องสร้าง `test/benchmark/` ใหม่) — เพิ่มเคสใน test file ของ
`session.ts`/`stats.ts` ที่มีอยู่แล้ว

---

## 5. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- **อ่าน opencode.db แบบ readonly เท่านั้น** (`PRAGMA query_only = ON`)
- **ห้าม parse `part.data` แบบเดาโครงสร้าง** — เช็ค `type` ก่อนทุกครั้ง, unknown type → skip
- **ห้ามเก็บ tool `input`/`output` เต็ม** — เก็บแค่ชื่อ tool + count
- **Derived metric ต้องติด label `derived:`**
- **`fapony_usage`/`fapony stats` เดิมไม่เปลี่ยน** — additive only, default output เท่าเดิม
- **Performance:** `part` table 66k+ rows → aggregate ด้วย SQL (`GROUP BY`, `json_extract`) ไม่ pull raw มา loop

---

## 6. ความเสี่ยง

| เสี่ยง | ทางหนี |
|---|---|
| `part.data` schema เปลี่ยนระหว่าง opencode เวอร์ชัน | เช็ค `type` field ก่อนเสมอ, unknown type → skip |
| output ยาวจนอ่านไม่ไหว (ปัญหาเดิมของ `fapony_usage`) | `detail` param opt-in, default ยังกระชับเหมือนเดิม |
| คนเข้าใจผิดว่า tool count = คุณภาพงาน | docs บอกชัดว่าเป็น activity signal ไม่ใช่ quality score |

---

## 7. References

- [src/session.ts](../src/session.ts) — `readPassiveUsage()` ที่ query session-level วันนี้ ต้อง extend
- [src/stats.ts](../src/stats.ts) — `getStatsData()`
- [src/mcp/tools/usage.ts](../src/mcp/tools/usage.ts) — `fapony_usage` MCP tool ต้อง extend `detail`
- [src/cost.ts](../src/cost.ts) — `sumSpawnCost()`, `estimateUsd()`
- [src/parse.ts](../src/parse.ts) — `qualityScore()`, `VERDICT_GRADES`
- [src/db/types.ts](../src/db/types.ts) — `Config`, `Run`, `Event`
- [plan/PLAN-mcp-verification-pivot.md](done/2026-09-09-PLAN-mcp-verification-pivot.md) — measure-first positioning, north star

**ตัดออกจาก plan นี้ (ยังไม่มี evidence ว่าจำเป็น — ถ้าจะทำ ให้เปิด plan ใหม่ตอนมี need จริง):**
benchmark harness ข้าม model/agent, export txt/JSON report, web server, TAR/TER/RLE/SBC/TDE
