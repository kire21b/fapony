# PLAN-central-benchmark.md — ส่ง measurement ไป server กลางเพื่อ benchmark

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-09
> **Amended:** 2026-09-09 — sync กับ PLAN-usage-depth.md ที่ขยายแล้ว (benchmark framework, derived metrics, export, web serve)
> **Supersede:** ไม่มี (plan เดิมยังคง scope เดิม)
> **Source spec:** extend telemetry pattern ที่มีอยู่แล้ว + benchmark framework จาก [PLAN-usage-depth.md](PLAN-usage-depth.md)

---

## 1. เป้าหมาย (ทำไม)

`fapony telemetry` มี opt-in aggregate ส่งไป server ได้แล้ว (pass rate, cost, by-model) แต่ยัง
ไม่มี **derived metric granularity** (จาก [PLAN-usage-depth.md](PLAN-usage-depth.md)) และไม่มี
ทางส่ง **benchmark result** (4 report จาก benchmark run) เพื่อทำ benchmark ที่เชื่อถือได้ระดับ leaderboard

งานนี้แยกเป็น **สามชั้นที่ต้องไม่ปนกัน**:

1. **Metrics ชั้นเดิม (extend):** derived metrics จาก usage-depth (ES, TAR, TER, RLE, CPQ, TDE) เป็น aggregate — เข้ากฎ telemetry เดิมได้พอดี (ตัวเลขล้วน ไม่ใช่ content)
2. **Benchmark result submission (ของใหม่):** 4 report txt/JSON จาก `fapony benchmark run` — เป็นคนละ consent surface จาก telemetry เพราะ TELEMETRY.md สัญญาไว้ตรง ๆ ว่า **"ไม่เคยส่ง content"** — จะฝ่าฝืนสัญญานั้นไม่ได้ ต้องเป็น flow ที่ user เห็นของจริงก่อนกดส่งทุกครั้ง ไม่ใช่ config toggle
3. **Web serve (local display):** `fapony benchmark serve` แสดงผล localhost — ไม่เกี่ยวกับ server กลาง เป็น convenience ให้ user ดู comparison บนเครื่องตัวเอง

**ความสัมพันธ์ของชั้นทั้งสาม:**

```
fapony benchmark run <variant>   → ผลิต benchmark report (usage-depth Phase B)
fapony benchmark compare <prompt> → เทียบ 4 variant (usage-depth Phase B)
fapony benchmark export <id>      → export txt/JSON (usage-depth Phase B)
fapony benchmark serve [port]     → localhost display (usage-depth Phase C)
fapony benchmark submit <id>      → ส่ง benchmark result ไป server กลาง (ชั้น 2 ของ plan นี้)
fapony telemetry show|send        → aggregate ขยายด้วย derived metrics (ชั้น 1 ของ plan นี้)
```

---

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**

### ชั้น 1 — extend telemetry payload (derived metrics จาก usage-depth)
- Extend `machine` payload ใน telemetry (`schema_version` bump: 2 → 3, additive) ด้วย derived metrics ใหม่จาก [PLAN-usage-depth.md](PLAN-usage-depth.md) §3:
  - `tool_call_counts` (by tool name, ข้าม session) — มาจาก `part` table `type='tool'` query
  - `step_timing` (avg/p50/p95 ms ต่อ step, ต่อ model) — มาจาก `part` table `type='step-finish'`
  - `efficiency_scores` (ES ต่อ model) — มาจาก `qualityScore(grade) / (costUSD × avgMinutes)`
  - `review_loop_efficiency` (RLE ต่อ model) — มาจาก `avg(review_turnaround) / maxRounds`
- ทุก field เป็น **aggregate ตัวเลขล้วน** ไม่มี content — เข้ากฎ telemetry เดิม
- **อ้างอิง schema:** [PLAN-usage-depth.md §3](PLAN-usage-depth.md) สำหรับสูตร ES/TAR/TER/RLE/CPQ/TDE ทั้งหมด

### ชั้น 2 — Benchmark result submission
- เพิ่มคำสั่ง `fapony benchmark submit <benchmark_id>` — **preview เต็มก่อนส่งทุกครั้ง**
  (แสดง benchmark report ที่จะแนบ ให้ user เห็นตรง ๆ ก่อนยืนยัน) ไม่มี `--yes`/auto-confirm flag
- Evidence ที่แนบ = benchmark report (txt/JSON จาก `fapony benchmark export`) + diff stat (files/lines changed, ไม่ใช่เนื้อ diff เต็ม) เว้นแต่ user เลือกแนบเนื้อ diff เองแบบ explicit ต่อ submission (default ไม่แนบ)
- Benchmark ที่ submit ต้องมาจาก `fapony benchmark run <variant_id>` ที่ tag ด้วย `bench/` prefix แล้วเทียบครบแล้ว — ไม่สามารถ submit run เดียวที่ยังไม่ได้เทียบ

### ชั้น 3 — Local web serve (convenience, ไม่เกี่ยวกับ server กลาง)
- **อ้างอิง:** [PLAN-usage-depth.md §6](PLAN-usage-depth.md) สำหรับ architecture, routes, chart data
- `fapony benchmark serve [port]` — localhost-only, ไม่ส่งข้อมูลไปไหน
- **ไม่ทำ** บน plan นี้ — เป็น scope ของ [PLAN-usage-depth.md Phase C] ที่เขียนไว้แล้ว

**ไม่ทำ:**

- ไม่ผูก benchmark submission เข้ากับ `telemetry.enabled` toggle — คนละ consent surface ห้ามปน
  (เปิด telemetry ไม่ได้แปลว่า auto-ส่ง benchmark result)
- ไม่ auto-submit หลัง `fapony benchmark run`/`fapony benchmark compare` จบ — ต้อง user สั่ง `benchmark submit` เองเสมอ
- ไม่ทำ leaderboard UI/dashboard ฝั่ง server — repo นี้เป็นแค่ sender ฝั่ง client
- ไม่ส่ง diff เนื้อหาเต็มโดย default — เสี่ยง secret/proprietary code หลุด ต้อง explicit opt-in
  ต่อ submission ไม่ใช่ default เปิด
- ไม่เดา schema ฝั่ง receiver — ตาม pattern telemetry เดิม (`schema_version` + reject unknown version)
- ไม่ทำ `fapony benchmark serve` บน plan นี้ — plan usage-depth เขียนไว้แล้ว ตรงนี้เป็น local display ไม่ใช่ server กลาง

---

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- `fapony telemetry show` เห็น `tool_call_counts`, `step_timing`, `efficiency_scores`, `review_loop_efficiency` ใน payload preview ก่อนส่งจริง
- `fapony benchmark submit <benchmark_id>` (ไม่มี endpoint ตั้งค่า) → error บอกวิธีตั้งค่า ไม่ crash
- `fapony benchmark submit <benchmark_id> --dry-run` (หรือ preview เป็น default behavior) แสดง benchmark report ที่จะส่งครบ ก่อนถาม confirm — ไม่มีทางส่งโดยไม่เห็น preview ก่อน
- `fapony benchmark serve` เริ่ม localhost server ได้ (อ้างอิง usage-depth Phase C)
- TELEMETRY.md ยังคงยืนยันได้ 100% ว่า "telemetry เดิมไม่เคยส่ง content" (regression: field เดิมไม่เปลี่ยนความหมาย)
- **Regression สำคัญ:** ค่า `fapony_usage` เดิม (total tokens/cost/session_count) ไม่เปลี่ยนแปลงเมื่อมี derived metrics ใหม่ — derived field ติด label `derived:` ใน JSON เสมอ
- `bun test` เขียว

---

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

### 4.1 Consent แยกชั้นเด็ดขาด
- เปิด `telemetry.enabled` ไม่ทำให้ `benchmark submit` ทำงานอัตโนมัติ หรือกลับกัน — สอง flag คนละความหมาย
- `fapony benchmark serve` (localhost display) ไม่ต้อง consent เลย — ข้อมูลไม่ออกนอกเครื่อง
- เปิด `benchmark submit` ไม่ทำให้ `fapony benchmark run` ทำงานอัตโนมัติ — ต้องสั่ง run เองก่อน

### 4.2 Schema versioned เหมือน telemetry เดิม
- `schema_version`, additive-only, reject unknown version ฝั่ง receiver
- Derived metrics (ES, TAR, TER, RLE, CPQ, TDE) เป็น field แยกภายใต้ `derived` namespace — ห้ามปนกับ provider-reported field เดิม
- **ข้อมูลเดิมไม่เปลี่ยน:** `session.tokens_*`, `session.cost`, `session.session_count` ค่าเดิมทุกตัว

### 4.3 Benchmark submit constraint
- Benchmark ที่ submit ต้องมี **benchmark_id** ที่ถูกต้อง (มาจาก `.fapony/benchmark.json` หรือ `benchmark/{id}/` directory)
- ต้องมี **ครบ 4 variant** สำหรับ benchmark_id นั้นก่อนถึงจะ submit ได้ (หรือระบุ `--variant <id>` เพื่อ submit เฉพาะ variant เดียว)
- **Preview ก่อน confirm ทุกครั้ง** — ไม่มี flag ข้าม preview ได้
- Evidence ที่แนบผ่าน allowlist เดิม (`.fapony/evidence.json`) — ห้าม agent เสนอ command นอก allowlist มาแนบเป็นหลักฐานได้ (กฎเดิมจาก verification_report)

### 4.4 Privacy & Safety
- ห้าม fapony เขียนไฟล์ใน target worktree เพิ่มจากงานนี้ — payload สร้างจาก SQLite/stdout เดิม
- `benchmark serve` ฟัง localhost เท่านั้น — ไม่公开โดยอัตโนมัติ
- prompt content ไม่เก็บใน state — เก็บแค่ `prompt_hash` (sha256) ไม่เก็บ text เต็ม

---

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| user สับสนว่า telemetry เดิมส่ง content ไปด้วยหรือเปล่า | กลาง | เสีย trust ทั้งระบบ (ผิดสัญญาที่เขียนไว้ใน TELEMETRY.md) | แยกคำสั่ง/เอกสารเด็ดขาด ไม่ใช้คำว่า "telemetry" เรียก benchmark submit เลย |
| diff/prompt มี secret หลุดไปตอน submit | สูงถ้าเปิด default | ข้อมูลรั่ว | default ไม่แนบเนื้อ diff, preview เต็มก่อน confirm ทุกครั้ง |
| server กลางยังไม่มีจริง (ยังไม่มี endpoint ให้ส่ง) | สูงตอนนี้ | ทำ client ไปก่อนไม่มีที่ทดสอบจริง | ทำ `--dry-run`/preview เป็น first deliverable ที่ทดสอบได้เองโดยไม่ต้องมี server จริง |
| derived metric คำนวณผิด (เช่น ES divider=0) | กลาง | ตัวเลขผิดใน telemetry | จัดการ edge case ใน code: costUSD=0 → ES=Infinity แสดงเป็น `null` ไม่ใช่ตัวเลข; grade=fail → qualityScore=0 → CPQ=Infinity → `null` |
| benchmark submit ส่งข้อมูลไม่ครบ (missing variant) | กลาง | leaderboard ไม่สมบูรณ์ | ตรวจสอบ benchmark_id มีครบทุก variant ก่อนอนุญาต submit |
| tool-call/step-timing aggregate ระบุตัวตนได้ทางอ้อม | ต่ำ-กลาง | privacy concern แม้เป็นแค่ตัวเลข | ยังคง redact worktree เป็น basename เหมือนเดิม, ไม่ผูก timestamp ละเอียดเกินจำเป็น |
| `fapony benchmark serve` ถูกเปิด public โดยไม่ตั้งใจ | ต่ำ | ข้อมูลรั่ว | localhost-only default, `fapony benchmark serve` ต้องสั่งเอง, ใส่ warning ใน console |

---

## 6. ขั้นตอน (เรียงลำดับ, แต่ละขั้น verify ได้)

1. **[Pre-condition] ทำ [PLAN-usage-depth.md](PLAN-usage-depth.md) ให้เสร็จ** — เป็น pre-condition สำหรับทุกชั้นบน:
   - Phase A (deep query extension) → ได้ tool_call_counts, step_timing จาก opencode.db
   - Phase A (derived metrics) → ได้ ES, TAR, TER, RLE, CPQ, TDE สูตร
   - Phase B (benchmark framework) → ได้ `fapony benchmark run`, `compare`, `export`
   - Phase C (web serve) → ได้ `fapony benchmark serve`
   - **Verify:** ทุก Phase ของ usage-depth เขียว (bun test, regression, cross-check)

2. **extend telemetry schema → v3** (`tool_call_counts`, `step_timing`, `efficiency_scores`, `review_loop_efficiency`) → verify: `fapony telemetry show` เห็น field ใหม่, field เดิมค่าไม่เปลี่ยน (regression test), derived field ติด label `derived:` ใน JSON

3. **ออกแบบ + implement `fapony benchmark submit <benchmark_id>`** พร้อม preview-before-confirm → verify:
   - รันแล้วเห็น preview เต็ม (benchmark report ทั้งหมด)
   - ไม่มี network call จนกว่า confirm
   - ส่งเฉพาะ benchmark_id ที่มีครบทุก variant
   - `--dry-run` แสดง preview ไม่ส่งจริง

4. **implement `fapony benchmark serve [port]`** (อ้างอิง usage-depth Phase C) → verify: `curl localhost:3100/api/reports` ได้ JSON, `curl localhost:3100/` ได้ HTML, จำกัด localhost only

5. **เอกสาร** — TELEMETRY.md เพิ่ม section แยกชัดจาก benchmark submit, README ลิงก์ทั้ง 3 ชั้น, `docs/benchmark.md` → verify: อ่านแล้วแยกออกว่า telemetry อะไร auto-aggregate, benchmark submit ต้อง confirm ทุกครั้ง, benchmark serve คือ localhost display

6. **`bun test`** → verify: เขียว, regression ค่าเดิมไม่เปลี่ยน

---

## 7. ตัวอย่าง (เห็นภาพ)

### 7.1 ชั้น 1 — aggregate เดิม ขยาย field (ยังคง opt-in ผ่าน config เหมือนเดิม)
```bash
fapony telemetry show   # เห็น tool_call_counts, step_timing, efficiency_scores, review_loop_efficiency ใหม่ใน payload
# Payload snippet:
# {
#   "schema_version": 3,
#   "machine": {
#     "tool_call_counts": { "grep": 3400, "edit": 2100, "bash": 890 },
#     "step_timing": { "avg_ms": 45000, "p50_ms": 32000, "p95_ms": 89000 },
#     "efficiency_scores": { "claude-sonnet-4": 0.213, "codex-1.5": 0.189 },
#     "review_loop_efficiency": { "claude-sonnet-4": 1.5, "codex-1.5": 1.8 }
#   }
# }
```

### 7.2 ชั้น 2 — ของใหม่ ต้องสั่งเองทุกครั้ง ไม่มี auto
```bash
# รัน benchmark 4 variant (usage-depth Phase B)
fapony benchmark run claude-slow
fapony benchmark run claude-fast
fapony benchmark run codex-slow
fapony benchmark run codex-fast

# เทียบก่อนส่ง
fapony benchmark compare --prompt "Fix all TypeScript type errors"

# Export 4 report
fapony benchmark export claude-slow --format txt
fapony benchmark export claude-fast --format txt
fapony benchmark export codex-slow --format txt
fapony benchmark export codex-fast --format txt

# ดูบนเครื่อง (usage-depth Phase C)
fapony benchmark serve 3100

# ส่งไป server กลาง (ชั้น 2 ของ plan นี้)
fapony benchmark submit fix-types-20260909
# ── preview: จะส่งอะไรไปที่ https://... ──
#   benchmark: fix-types-20260909
#   variants: 4/4 complete (claude-slow, claude-fast, codex-slow, codex-fast)
#   ES leaderboard: claude-fast(0.312) > codex-fast(0.278) > claude-slow(0.213) > codex-slow(0.189)
#   evidence: test=passed, typecheck=passed
#   diff stat: 4 files, +120/-30 (ไม่แนบเนื้อ diff)
# ส่งจริงไหม? (y/N)
```

### 7.3 ชั้น 3 — localhost serve (convenience display)
```bash
fapony benchmark serve 3100
# Server listening on http://localhost:3100
# → http://localhost:3100/  — list all benchmark runs
# → http://localhost:3100/compare/fix-types-20260909 — comparison table + SBC chart
# → http://localhost:3100/api/reports — JSON API
# → http://localhost:3100/api/compare?prompt=... — comparison JSON
#
# ⚠ localhost only — not publicly accessible
```

---

## 8. References

- [PLAN-usage-depth.md](PLAN-usage-depth.md) — หลัก: benchmark framework, derived metrics formulas, export format, web serve architecture — plan นี้อ้างอิงและขยายจาก plan นี้
- [TELEMETRY.md](../TELEMETRY.md) — กฎ "ไม่เคยส่ง content" ที่ต้องรักษาไว้ไม่ให้ปนกับ layer ใหม่
- [src/telemetry.ts](../src/telemetry.ts) — payload builder เดิมที่ต้อง extend แบบ additive (schema_version 2 → 3)
- [src/stats.ts](../src/stats.ts) — `getStatsData()` ที่มี `byModel`, `byGrade`, `usage` — ที่มาของ derived metrics
- [src/session.ts](../src/session.ts) — `readPassiveUsage()` ที่ query session-level วันนี้ ต้อง extend ด้วย Phase A
- [src/cost.ts](../src/cost.ts) — `sumSpawnCost()`, `estimateUsd()`, `BYTES_PER_TOKEN` — ที่มาของ ES/CPQ calculation
- [src/gates.ts](../src/gates.ts) — `enrichGateWindows()` — ที่มาของ RLE calculation
- [src/parse.ts](../src/parse.ts) — `qualityScore()`, `VERDICT_GRADES` — ที่มาของ quality score สำหรับ ES
- [src/mcp/tools/usage.ts](../src/mcp/tools/usage.ts) — `fapony_usage` MCP tool ที่ต้อง extend `detail`
- [src/mcp/tools/stats.ts](../src/mcp/tools/stats.ts) — `fapony_stats` MCP tool
- [src/db/types.ts](../src/db/types.ts) — `Config` type ต้องเพิ่ม `benchmark` field
- [src/init.ts](../src/init.ts) — `initProject()` ต้องเพิ่ม `benchmark.json` scaffold
- [plan/PLAN-verification-report.md](PLAN-verification-report.md) §4 — provenance/labeling rules ที่ใช้ร่วม
- [src/mcp/evidence.ts](../src/mcp/evidence.ts) — allowlist rules ที่ benchmark submit ต้องใช้ร่วม
- [src/mcp/primitives.ts](../src/mcp/primitives.ts) — `VerificationReport` shape ที่ benchmark report ต้องสอดคล้อง
