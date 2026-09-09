# PLAN-usage-depth.md — วัดผลละเอียดสุดขีด: tool calls, per-step, model A/B benchmark

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-09
> **Amended:** 2026-09-09 — ขยายจาก Tier 1–2 เป็น full benchmark framework พร้อม export + web server
> **Source spec:** data สำรวจแล้วจาก opencode.db + fapony state.db ทั้งหมด (ดู §7)

---

## 1. เป้าหมาย (ทำไม) — 3 ชั้น

### ชั้น 1: วัดลึก (ทำไม่ต้องมี)
`fapony_usage` วันนี้บอกได้แค่ "model นี้ใช้ token/cost รวมเท่าไหร่ต่อ session" — ไม่พอสำหรับคำถามที่ต้องการจริง:
- **model นี้ทำงานยังไง** (เรียก tool อะไรกี่ครั้ง, กี่ step ถึงจบ, ช้าตรงไหน)
- **model A vs B บน prompt เดียวกัน ใครคุ้มกว่า**

### ชั้น 2: Benchmark (ทำไมต้องมี)
ข่าวดี: OpenCode เก็บข้อมูลนี้อยู่แล้วใน `part` table (tool calls, step-finish token breakdown ต่อ step) — **ไม่ต้องเพิ่ม instrumentation ใหม่** แค่ query ลึกขึ้น
แต่ข้อมูล passive อย่างเดียว **ไม่สามารถ** เทียบ "prompt เดียวกัน" ข้าม model ได้อัตโนมัติ เพราะ:
- `session.title` เป็น free text, ไม่ใช่ task ID
- ไม่มี signal ว่า session ไหนคือ "prompt เดียวกัน" กับ session ไหน

**ทางแก้:** ออกแบบ **benchmark harness** ที่:
1. User กำหนด prompt เดียว (benchmark prompt)
2. รันกับ model/agent หลายชุด
3. Tag session ด้วย `benchmark_id` + `variant` (model + agent)
4. Query แล้วเปรียบเทียบข้าม variant ได้

### ชั้น 3: Export + Display (ทำไมต้องมี)
- **4 reports → export txt** — เปรียบเทียบกันได้ทันทีโดยไม่ต้องเปิด MCP
- **Web server** — แสดงผลเป็น chart/table เปรียบเทียบข้าม model/agent สาธารณะได้ (ถ้า user ต้องการ)
- **Machine-readable JSON** — สามารถ pipe ไป dashboard ภายนอกได้

---

## 2. Data Source ที่มีจริง (สำรวจ 2026-09-09)

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
- `type='tool'`: `{"type":"tool","tool":"grep","state":{"status":"completed","time":{"start":1782794319518,"end":1782794319587}}}`
- `type='step-finish'`: `{"type":"step-finish","tokens":{"total":19679,"input":19454,"output":23,"reasoning":202,"cache":{"write":0,"read":0}},"cost":0}`
- `type='assistant'`, `type='user'`: ข้อความ conversation

**ข้อมูลจริงที่สำรวจ:** 66k+ tool parts ในเครื่องเดียว → query ต้อง aggregate ใน SQL ไม่ดึง raw มา loop

### 2.2 Fapony State DB (`~/.config/fapony/state.db`) — SQLite

**`runs` table**: `id, worktree, plan, mem_id, status, base_sha, round, created_at, updated_at`
**`events` table**: `id, run_id, ts, kind, data`
- `kind='spawn'`: `{role, model, bytes_in, bytes_out, usd_estimate}` (update ใน place)
- `kind='gate'`: `{verdict, note, round}` (JSON)
- `kind='handoff'`: `{claimed, commits, checks, uncertain, not_done}` (JSON)
- `kind='route'`, `kind='commit'`, `kind='plan'`, `kind='stop'`, `kind='stalled'`, `kind='interrupted'`

### 2.3 Config (`fapony.config.json`) — pricing
```json
{
  "pricing": {
    "executor": { "inputPer1k": 3.0, "outputPer1k": 15.0 }
  }
}
```
- `BYTES_PER_TOKEN = 4` (proxy) → `usd_estimate = (bytes_in/4/1000)*inputPer1k + (bytes_out/4/1000)*outputPer1k`
- `pricing:null` = ปิด USD estimate (แต่ byte measurement ยังทำงาน)

---

## 3. Derived Metrics — สูตรคำนวณเต็มรูปแบบ

### 3.1 Efficiency Score (ES) — ตัวเลขเดียวที่เปรียบเทียบ model/agent ได้

```
ES = qualityScore(grade) / (costUSD × avgMinutes)
```
- `qualityScore`: pass-excellent=5, pass-good=4, pass-adequate=3, pass=3, fail=0, uncertain=1
- `costUSD`: จาก `sumSpawnCost(events)` — รวมทุกรอบ
- `avgMinutes`: จาก `(updated_at - created_at)` ของ run

**ตีความ:** ES สูง = คุณภาพดี / ต้นทุนต่ำ / เร็ว = คุ้มที่สุด
**กรณี:** ถ้า `costUSD=0` (ไม่มี pricing) → ES ใช้ `bytes_in + bytes_out` เป็น proxy แทน

### 3.2 Tool Activity Ratio (TAR) — วัด "ความขยับ" ของ agent

```
TAR = toolCallCount / stepCount
```
- `toolCallCount`: นับจาก `part` type='tool' ทั้งหมดใน session
- `stepCount`: นับจาก `part` type='step-finish' ทั้งหมด

**ตีความ:**
- TAR สูง → agent เรียก tool เยอะต่อ step (detail-oriented, อาจรอบคอบเกิน)
- TAR ต่ำ → agent ทำงานต่อ step ละ tool น้อย (อาจมีประสิทธิภาพ หรือข้ามขั้นตอน)
- **ไม่ใช่ quality signal** — ต้องใช้คู่กับ qualityScore เท่านั้น

### 3.3 Token Efficiency Ratio (TER) — ต้นทุน token ต่อ unit งาน

```
TER = (tokens_input + tokens_output) / files_changed
```
- `files_changed`: จาก `git diff --stat` (tool handoff_collect)
- ถ้า `files_changed=0` → TER ไม่นิยาม (เขียนเป็น `null`)

**ตีความ:** TER ต่ำ = ใช้ token น้อยต่อไฟล์ที่เปลี่ยน = มีประสิทธิภาพ

### 3.4 Review Loop Efficiency (RLE) — วัฏจักร review ใช้เวลานานเท่าไหร่

```
RLE = avg(review_turnaround) / maxRounds
```
- `review_turnaround`: จาก `route→gate` เวลาใน `events` (วินาที → นาที)
- `maxRounds`: จาก `config.review.maxRounds` (default 2)

**ตีความ:** RLE ต่ำ = review เร็ว → วนเสร็จเร็ว

### 3.5 Cost Per Quality Point (CPQ) — ราคาเพื่อความมั่นใจ 1 คะแนน

```
CPQ = costUSD / qualityScore(grade)
```
- grade=0 (fail) → CPQ = `Infinity` (ไม่มีคุณภาพ ไม่มีราคา)
- grade=1 (uncertain) → CPQ = `costUSD / 1` = costUSD
- grade=5 (pass-excellent) → CPQ = `costUSD / 5`

**ตีความ:** CPQ ต่ำ = จ่ายน้อยได้คะแนนสูง = คุ้ม

### 3.6 Step Burn Curve (SBC) — token burn ต่อ step

```
SBC[step_i] = cumulative_tokens_at(step_i) / step_i
```
- คำนวณจาก `part` type='step-finish' ที่ `tokens.total` สะสม
- plot เป็นกราฟแสดงว่า token burn เร่งขึ้นตอนไหน

**ประโยชน์:** ตรวจจับจุดที่ agent "เริ่มเสียทาง" — ถ้า SBC พุ่งขึ้นกะทันหัน แปลว่าขั้นตอนนั้นใช้ token มากผิดปกติ

### 3.7 Tool Distribution Entropy (TDE) — ความหลากหลายของการใช้ tool

```
TDE = -Σ (p_i × log2(p_i))
```
- `p_i = count(tool_i) / total_tool_calls`
- ค่าระหว่าง 0 (ใช้ tool เดียวตลอด) ถึง log2(N) (กระจายเท่าๆ กัน)

**ตีความ:**
- TDE สูง → agent ใช้เครื่องมือหลากหลาย (อาจกำลังสำรวจ)
- TDE ต่ำ → agent ใช้ tool ซ้ำๆ (อาจทำงานที่คุ้นเคย)
- **ไม่ใช่ quality signal** — เป็น profile signal

---

## 4. Benchmark Framework — Same Prompt × 2 Models × 2 Agents = 4 Reports

### 4.1 Tagging Convention (ก่อนจะเทียบได้)

เพิ่ม field ใน `fapony.config.json`:
```json
{
  "benchmark": {
    "enabled": false,
    "tag_prefix": "bench",
    "variants": []
  }
}
```

**Variant shape:**
```json
{
  "id": "claude-slow",
  "model": "claude-sonnet-4",
  "agent": "claude-code",
  "prompt_file": "bench/prompt.md",
  "tags": ["bench", "claude-slow"]
}
```

**Tag กลไก:**
- Session title ใน opencode.db ต้องมี prefix จาก variant id
- `fapony init` scaffold `.fapony/benchmark.json` สำหรับแต่ละ project ที่ want benchmark
- `fapony benchmark run <variant_id>` — รันพร้อม tag อัตโนมัติ

### 4.2 Workflow

```
1. User กำหนด prompt เดียว: "fix all type errors in src/"
2. fapony benchmark run claude-slow → opencode run พร้อม tag "bench/claude-slow"
3. fapony benchmark run claude-fast → opencode run พร้อม tag "bench/claude-fast"
4. fapony benchmark run codex-slow → opencode run พร้อม tag "bench/codex-slow"
5. fapony benchmark run codex-fast → opencode run พร้อม tag "bench/codex-fast"
6. fapony benchmark compare --prompt "fix all type errors" → 4 reports
```

### 4.3 Query Logic (SQL ที่ใช้เทียบ)

```sql
-- ดึง session ทั้งหมดที่ tag ด้วย benchmark prefix
SELECT s.model, s.title, s.tokens_input, s.tokens_output, s.cost, s.time_created
FROM session s
JOIN project p ON s.project_id = p.id
WHERE s.title LIKE 'bench/%'
ORDER BY s.time_created;

-- Tool call breakdown ต่อ model สำหรับ benchmark sessions
SELECT s.model, json_extract(p.data, '$.tool') AS tool_name, COUNT(*) AS count
FROM part p
JOIN session s ON p.session_id = s.id
JOIN project p2 ON s.project_id = p2.id
WHERE p.type = 'tool' AND s.title LIKE 'bench/%'
GROUP BY s.model, tool_name
ORDER BY s.model, count DESC;

-- Step count + token per step ต่อ model
SELECT s.model, COUNT(*) AS steps, SUM(json_extract(p.data, '$.tokens.total')) AS total_tokens
FROM part p
JOIN session s ON p.session_id = s.id
JOIN project p2 ON s.project_id = p2.id
WHERE p.type = 'step-finish' AND s.title LIKE 'bench/%'
GROUP BY s.model;
```

### 4.4 4 Report Shape (export เป็น txt)

แต่ละ report มี sections เหมือนกันทุกประการ เพื่อให้เทียบกันได้ง่าย:

```
=== BENCHMARK REPORT ===
Variant:       claude-slow
Model:         claude-sonnet-4
Agent:         claude-code
Prompt:        fix all type errors in src/
Date:          2026-09-09T12:00:00Z

--- PASSAGE ---
Status:        pass-good
Grade Score:   4/5
Quality:       4

--- COST ---
USD Estimate:  $0.0450
Bytes In:      50000
Bytes Out:     30000
Spawns:        3

--- TIME ---
Total Duration: 12.5 min
Avg Exec (spawn→route): 1.2 min
Avg Review (route→gate): 3.0 min
RLE:           1.5 min/round

--- TOKENS ---
Input:         50000
Output:        30000
Reasoning:     2000
Cache Read:    10000
Cache Write:   0
Total Steps:   8
SBC:           [6250, 6500, 6800, 7100, 7500, 8200, 9100, 10000]

--- TOOLS ---
Total Calls:   64
By Tool:       grep=30, edit=20, bash=10, other=4
TAR:           8.0 (8 calls/step)
TDE:           1.2 (low diversity)

--- DERIVED ---
ES:            0.213  (quality/cost×time)
TER:           533.3  (tokens/file)
CPQ:           0.0113 ($/quality-point)

--- HANDOFF ---
Files Changed: 5
Lines Changed: 120
Insertions:    80
Deletions:     40
Commits:       abc123, def456
Branch:        feature/fix-types
```

### 4.5 Comparison Table (4 reports → 1 summary)

```
=== BENCHMARK COMPARISON ===
Prompt: "fix all type errors in src/"

variant         | model           | ES     | Cost   | Time | Tools | Grade
----------------+-----------------+--------+--------+------+-------+------
claude-slow     | claude-sonnet-4 | 0.213  | $0.045 | 12.5m | 64   | pass-good
claude-fast     | claude-sonnet-4 | 0.312  | $0.062 | 8.0m  | 42   | pass-excellent
codex-slow      | codex-1.5       | 0.189  | $0.038 | 15.0m | 89   | pass-adequate
codex-fast      | codex-1.5       | 0.278  | $0.051 | 9.5m  | 56   | pass-good

WINNER (ES):    claude-fast
WINNER (CPQ):   codex-slow
WINNER (Cost):  codex-slow
WINNER (Speed): claude-fast
```

---

## 5. Export Format — 4 Report เป็น txt

### 5.1 File Naming Convention

```
benchmark/{benchmark_id}/{variant_id}_{timestamp}.txt
```

ตัวอย่าง:
```
benchmark/fix-types-20260909/claude-slow_20260909T120000.txt
benchmark/fix-types-20260909/claude-fast_20260909T120000.txt
benchmark/fix-types-20260909/codex-slow_20260909T120000.txt
benchmark/fix-types-20260909/codex-fast_20260909T120000.txt
```

### 5.2 Export Function

```typescript
// src/benchmark/export.ts
export function exportReport(report: BenchmarkReport, format: "txt" | "json"): string {
  if (format === "json") return JSON.stringify(report, null, 2);

  // txt format — fixed sections, machine-parsable via regex
  const lines: string[] = [];
  lines.push("=== BENCHMARK REPORT ===");
  // ... fixed sections
  return lines.join("\n");
}
```

### 5.3 JSON Schema (machine-readable สำหรับ web server)

```json
{
  "$schema": "benchmark-report-v1",
  "variant_id": "claude-slow",
  "model": "claude-sonnet-4",
  "agent": "claude-code",
  "prompt": "fix all type errors in src/",
  "prompt_hash": "sha256:abc123",
  "timestamp": "2026-09-09T12:00:00Z",
  "passage": {
    "status": "pass-good",
    "grade_score": 4,
    "quality": 4
  },
  "cost": {
    "usd_estimate": 0.0450,
    "bytes_in": 50000,
    "bytes_out": 30000,
    "spawns": 3
  },
  "time": {
    "total_duration_min": 12.5,
    "avg_exec_min": 1.2,
    "avg_review_min": 3.0,
    "rle_min_per_round": 1.5
  },
  "tokens": {
    "input": 50000,
    "output": 30000,
    "reasoning": 2000,
    "cache_read": 10000,
    "cache_write": 0,
    "total_steps": 8,
    "sbc": [6250, 6500, 6800, 7100, 7500, 8200, 9100, 10000]
  },
  "tools": {
    "total_calls": 64,
    "by_tool": { "grep": 30, "edit": 20, "bash": 10, "other": 4 },
    "tar": 8.0,
    "tde": 1.2
  },
  "derived": {
    "es": 0.213,
    "ter": 533.3,
    "cpq": 0.0113
  },
  "handoff": {
    "files_changed": 5,
    "lines_changed": 120,
    "insertions": 80,
    "deletions": 40,
    "commits": ["abc123", "def456"],
    "branch": "feature/fix-types"
  },
  "meta": {
    "source": "opencode_db",
    "session_ids": ["sess-1", "sess-2", "sess-3"],
    "fapony_run_ids": [42]
  }
}
```

---

## 6. Web Server Display (optional — user ต้องการถึงทำ)

### 6.1 Architecture

```
benchmark/
  reports/          # txt + json files (source of truth)
  server/
    index.ts        # static file server + API
    compare.ts      # generate comparison HTML
    charts.ts       # ASCII/HTML chart rendering
```

### 6.2 Minimal HTTP Server

```typescript
// src/benchmark/server.ts
// ใช้ Bun.serve() — zero dependency, inline
export function startBenchmarkServer(port = 3100): void {
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/reports") return serveReports();
      if (url.pathname === "/api/compare") return serveComparison();
      if (url.pathname === "/") return serveIndex();
      // serve static files from benchmark/reports/
    },
  });
}
```

### 6.3 Routes

| Route | Content |
|-------|---------|
| `/` | Index — list all benchmark runs, links to compare |
| `/api/reports` | JSON array of all benchmark reports |
| `/api/reports/:variant_id` | Single report JSON |
| `/api/compare?prompt=...` | Comparison table across variants for a prompt |
| `/compare/:prompt_hash` | HTML page with charts + comparison table |
| `/static/*` | CSS/JS for web display |

### 6.4 Chart Data (ASCII → HTML)

จาก SBC (Step Burn Curve) และ token data:
```
Token Burn by Step (claude-slow vs claude-fast)
Step:  1    2    3    4    5    6    7    8
claude-slow:  ████ █████ ██████ ██████ ████████ ██████████ ████████████ ██████████████
claude-fast:  ███  ████  █████  ██████  ██████   ██████   ███████  ████████
```

แปลงเป็น HTML canvas chart เมื่อ display ผ่าน web server

### 6.5 Public Display Safety

- **Default: not public** — server ไม่เริ่มจนกว่า user สั่ง `fapony benchmark serve`
- **No auto-upload** — ข้อมูลอยู่เครื่อง user เท่านั้น
- **No external URL** — server ฟัง localhost เท่านั้น
- **JSON export** — ถ้า user อยาก public ได้ ส่ง JSON ไป hosting เอง

---

## 7. Implementation Steps (เรียงลำดับ, แต่ละขั้น verify ได้)

### Phase A: Deep Query Extension (Tier 1–2 จาก plan เดิม)

**A1. Extend `readPassiveUsage()` → `readPassiveUsageDetail()`**
- เพิ่ม `detail: true` parameter ที่ `fapony_usage` MCP tool
- Query `part` table: tool-call breakdown ต่อ model (`GROUP BY json_extract(data, '$.tool')`)
- Query `part` table: step-finish breakdown ต่อ session
- Cross-check: sum ของ step tokens ต้องตรงกับ `session.tokens_*` (หรืออธิบายส่วนต่างได้)
- **Verify:** unit test เทียบผลกับ raw SQL บน fixture DB 3 model

**A2. เพิ่ม derived metrics ใน `getStatsData()` / `buildPayload()`**
- ES, TAR, TER, RLE, CPQ, TDE — คำนวณจากข้อมูลที่ query ได้แล้ว
- ทุก derived metric ติด label `derived:` ใน output JSON
- **Verify:** `fapony stats` แสดง derived metrics ไม่ชนกับ provider-reported

**A3. Tool-call breakdown query**
- `src/mcp/tools/usage.ts` — เพิ่ม `detail: true` → คืน `tool_breakdown: { tool_name: count }` ต่อ model
- `src/session.ts` — เพิ่ม `readToolBreakdown()` helper
- **Verify:** cross-check กับ `sqlite3 opencode.db` query ตรงๆ 3 model

**A4. Per-step timeline query**
- `src/session.ts` — เพิ่ม `readStepTimeline()` → `Array<{step, tokens, cost, reason}>`
- **Verify:** sum ตรงกับ session tokens (or explain delta)

### Phase B: Benchmark Framework (Same Prompt × Variants)

**B1. Config + scaffolding**
- เพิ่ม `benchmark` field ใน `Config` type (`src/db/types.ts`)
- `fapony init` scaffold `.fapony/benchmark.json` (template + comment)
- `src/init.ts` — เพิ่ม `benchmark.json` ใน scaffold list
- **Verify:** `init` สร้าง benchmark.json ได้, init ซ้ำ error

**B2. `fapony benchmark run <variant_id>`**
- อ่าน `.fapony/benchmark.json` → get variant config (model, agent, prompt_file)
- แท็ก session title ด้วย `bench/{variant_id}` ก่อน spawn
- รัน opencode พร้อม prompt จาก `prompt_file`
- บันทึก run_id ลง `.fapony/benchmark-state.json` (ติดตาม benchmark_id)
- **Verify:** run พร้อม tag ใน session.title, หา session ได้จาก `bench/%` prefix

**B3. `fapony benchmark compare <prompt>`**
- ค้นหา session ที่ `title LIKE 'bench/%'` + จับคู่กับ prompt hash
- Query ข้อมูลครบจาก opencode.db สำหรับทุก variant ของ prompt นี้
- คำนวณ ES, TAR, TER, RLE, CPQ สำหรับแต่ละ variant
- สร้าง comparison table
- **Verify:** compare แสดง 4 variants ตรงกัน, derived metrics คำนวณถูก

**B4. Export — `fapony benchmark export <variant_id> --format txt|json`**
- อ่าน benchmark report จาก state + query opencode.db
- render เป็น txt (fixed sections) หรือ JSON (machine-readable)
- บันทึกลง `benchmark/{benchmark_id}/{variant_id}_{timestamp}.{txt|json}`
- **Verify:** 4 report txt อ่านง่าย, JSON schema ถูกต้อง

### Phase C: Web Server Display

**C1. `fapony benchmark serve [port]`**
- `Bun.serve()` — static files + API routes
- ไม่เริ่มจนกว่า user สั่ง explicit
- **Verify:** `curl localhost:3100/api/reports` ได้ JSON, `curl localhost:3100/` ได้ HTML

**C2. Comparison page**
- HTML + JS สำหรับแสดง comparison table + SBC chart
- ข้อมูลจาก `/api/compare` endpoint
- **Verify:** open `localhost:3100/compare/fix-types-20260909` เห็น table + chart

**C3. Public export (user-initiated only)**
- `fapony benchmark publish <report_dir>` — generate standalone HTML + JSON bundle
- **Verify:** bundle เปิดได้บน hosting ใดๆ ไม่ต้อง server

### Phase D: Tests + Documentation

**D1. Tests**
- `test/benchmark/` — new test directory
- `test/benchmark/query.test.ts` — SQL query correctness (3 model cross-check)
- `test/benchmark/derived.test.ts` — ES/TAR/TER/RLE/CPQ/TDE calculation tests
- `test/benchmark/export.test.ts` — txt + JSON output shape tests
- `test/benchmark/compare.test.ts` — comparison table correctness
- `bun test` เขียวทุกอัน

**D2. Documentation**
- `docs/benchmark.md` — full guide
- README.md — benchmark section
- `docs/mcp-handcheck.md` — benchmark tool registration

---

## 8. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

### 8.1 Privacy & Safety
- **อ่าน opencode.db แบบ readonly เท่านั้น** (`PRAGMA query_only = ON`)
- **ห้าม parse `part.data` แบบเดาโครงสร้าง** — เช็ค `type` ก่อนทุกครั้ง
- **ห้ามเก็บ tool `input`/`output` เต็ม** — เก็บแค่ชื่อ tool + count + timing
- **Derived metric ต้องติด label** `derived:` — ห้ามปนกับ provider-reported
- **prompt content ไม่เก็บใน state** — เก็บแค่ `prompt_hash` (sha256) ไม่เก็บ text เต็ม

### 8.2 Consent
- **Benchmark ไม่ auto-run** — ต้องสั่ง `fapony benchmark run` เองทุกครั้ง
- **Benchmark ไม่ผูก `telemetry.enabled`** — คนละ consent surface
- **benchmark serve ฟัง localhost เท่านั้น** — ไม่公开โดยอัตโนมัติ

### 8.3 Schema / Backward Compatibility
- **schema_version สำหรับ benchmark ใหม่** — additive-only, receiver tolerance
- **`fapony_usage` เดิมไม่เปลี่ยน** — regression: total tokens/cost เท่าเดิมทุกตัว
- **`fapony stats` เดิมไม่เปลี่ยน** — derived metrics เพิ่มเป็น field ใหม่ ไม่แก้ค่าเดิม

### 8.4 Performance
- `part` table มี 66k+ rows → query ต้อง `GROUP BY` ใน SQL ไม่ดึง raw มา loop
- Benchmark compare ข้าม session ต้องใช้ index: `(session.title)` หรือ `(project_id, model)`

---

## 9. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| `part.data` schema เปลี่ยนระหว่าง opencode เวอร์ชัน | กลาง | query พังเงียบ ๆ หรือนับผิด | เช็ค `type` field ก่อนเสมอ, unknown type → skip, ใส่ version guard |
| จำนวนแถว `part` โตเร็ว query ช้า | กลาง | tool call ช้า/timeout | aggregate ด้วย SQL (`GROUP BY`, `json_extract`) ไม่ pull raw แล้ว loop |
| คนเข้าใจผิดว่า tool count = คุณภาพงาน | กลาง | ตีความผิด | docs บอกชัดว่าเป็น "activity signal" ไม่ใช่ quality score; ES/CPQ ต้องใช้คู่กัน |
| ไม่มี benchmark harness จาก opencode เอง | สูง | ต้องสร้าง wrapper | `fapony benchmark run` wrapper รอบ `opencode run` — tag session title ก่อน spawn |
| prompt hash collision | ต่ำ | เปรียบเทียบผิด | sha256 → collision probability ~2^128, เพียงพอ |
| output ยาวจนอ่านไม่ไหว | สูง | เหมือน `fapony_usage` เดิมที่ list model ยาวเป็นหน้า | default แสดง top-N + summary, `detail`/`limit` param ให้ agent ขอเจาะได้เอง |
| benchmark serve ถูกเปิด public โดยไม่ตั้งใจ | ต่ำ | ข้อมูลรั่ว | localhost-only default, `fapony benchmark serve` ต้องสั่งเอง, ใส่ warning ใน console |

---

## 10. ตัวอย่างเต็มรูปแบบ (เห็นภาพ)

### 10.1 ตั้ง benchmark
```bash
# สร้าง benchmark config
cat > .fapony/benchmark.json << 'EOF'
{
  "id": "fix-types-20260909",
  "prompt": "Fix all TypeScript type errors in src/ without changing behavior",
  "variants": [
    { "id": "claude-slow", "model": "claude-sonnet-4", "agent": "claude-code" },
    { "id": "claude-fast", "model": "claude-sonnet-4", "agent": "claude-code", "flags": ["--fast"] },
    { "id": "codex-slow", "model": "codex-1.5", "agent": "codex" },
    { "id": "codex-fast", "model": "codex-1.5", "agent": "codex", "flags": ["--fast"] }
  ]
}
EOF
```

### 10.2 รัน benchmark
```bash
fapony benchmark run claude-slow
fapony benchmark run claude-fast
fapony benchmark run codex-slow
fapony benchmark run codex-fast
```

### 10.3 เปรียบเทียบ
```bash
fapony benchmark compare --prompt "Fix all TypeScript type errors"
```

### 10.4 Export
```bash
# Export 4 report เป็น txt
fapony benchmark export claude-slow --format txt
fapony benchmark export claude-fast --format txt
fapony benchmark export codex-slow --format txt
fapony benchmark export codex-fast --format txt

# Export เป็น JSON สำหรับ web server
fapony benchmark export claude-slow --format json > bench/fix-types/claude-slow.json
```

### 10.5 Web server
```bash
fapony benchmark serve 3100
# เปิด http://localhost:3100
# เห็น comparison table + SBC chart + 4 report detail
```

---

## 11. References

- [src/session.ts](../src/session.ts) — `readPassiveUsage()` ที่ query session-level วันนี้ ต้อง extend
- [src/stats.ts](../src/stats.ts) — `getStatsData()` ที่ aggregate fapony runs/events แล้ว
- [src/telemetry.ts](../src/telemetry.ts) — `buildPayload()` machine-observed aggregates
- [src/mcp/tools/usage.ts](../src/mcp/tools/usage.ts) — `fapony_usage` MCP tool ต้อง extend `detail`
- [src/mcp/tools/stats.ts](../src/mcp/tools/stats.ts) — `fapony_stats` MCP tool
- [src/mcp/tools/report.ts](../src/mcp/tools/report.ts) — `verification_report` MCP tool
- [src/cost.ts](../src/cost.ts) — `sumSpawnCost()`, `estimateUsd()`, `BYTES_PER_TOKEN`
- [src/gates.ts](../src/gates.ts) — `enrichGateWindows()` per-round gate enrichment
- [src/parse.ts](../src/parse.ts) — `qualityScore()`, `VERDICT_GRADES`, `parseGateEventData()`
- [src/db/types.ts](../src/db/types.ts) — `Config`, `Run`, `Event`, `RunStatus`
- [src/db/getters.ts](../src/db/getters.ts) — `pricingFor()`, `roleModel()`, role config
- [src/db/defaults.ts](../src/db/defaults.ts) — `DEFAULT_CONFIG`, `DEFAULT_ROLE_TIMEOUTS`
- [src/db/load.ts](../src/db/load.ts) — `loadConfig()`, `faponyDir()`
- [src/db/store.ts](../src/db/store.ts) — `openDb()`, `newRun()`, `addEvent()`, `getRun()`, `getEvents()`
- [src/mcp/primitives.ts](../src/mcp/primitives.ts) — `VerificationReport`, `CheckResult`, `EvidenceItem`
- [src/mcp/evidence.ts](../src/mcp/evidence.ts) — `collectEvidence()`, `readEvidenceConfig()`
- [src/mcp/tools/index.ts](../src/mcp/tools/index.ts) — `TOOLS` array, tool definitions
- [src/mcp/transport.ts](../src/mcp/transport.ts) — `dispatch()`, `cmdMcp()`
- [src/init.ts](../src/init.ts) — `initProject()` scaffold — ต้องเพิ่ม `benchmark.json`
- [plan/PLAN-mcp-verification-pivot.md](PLAN-mcp-verification-pivot.md) — measure-first positioning, north star
- [plan/PLAN-central-benchmark.md](PLAN-central-benchmark.md) — server ส่งข้อมูล benchmark
- [plan/PLAN-verification-report.md](PLAN-verification-report.md) §4 — provenance/labeling rules
- [docs/mcp-handcheck.md](../docs/mcp-handcheck.md) — MCP protocol + adapter examples
- [AGENTS.md](../AGENTS.md) — architecture tree, DB schema, config schema
- [src/db/store.ts](../src/db/store.ts) — SCHEMA_VERSION, migrations, `PRAGMA user_version`
