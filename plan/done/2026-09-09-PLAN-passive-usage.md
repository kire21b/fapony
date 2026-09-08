# PLAN-passive-usage — วัด usage จาก opencode session โดยไม่ต้อง agent report

> ✅ **shipped** (fa53052) · **Owner:** delamind · **Created:** 2026-09-09
> **Source spec:** [spec/SPEC-passive-usage.md](../spec/SPEC-passive-usage.md) (step 1)

---

## 1. เป้าหมาย (ทำไม)

fapony ต้องวัด token/cost/model ของ opencode session ได้เอง โดยไม่ต้องให้ agent รายงาตัวเอง — ข้อมูลที่ได้ต้องเป็น machine-observed (จาก client DB) ไม่ใช่ unverified claim และต้องไม่เก็บ content เต็มลง fapony db

Thesis: MCP = หน้าเรียกสำหรับสิ่งที่ต้องร่วมมือ (evidence/verdict) ส่วนการวัดที่ไม่ต้องขอต้องมาจากฝั่ง client ที่ fapony คำนวณเอง

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- อ่าน opencode session storage (`~/.local/share/opencode/opencode.db` → `session` table) แบบ read-only
- extract aggregate token/cost/model ต่อ worktree ผ่าน `project_id` join `project.worktree`
- เพิ่ม `usage` section ใน `StatsData` + `fapony stats` formatter
- เพิ่ม MCP tool `passive_usage` — read-only view
- เพิ่ม `fapony install --platform opencode` — idempotent, --dry-run, แตะเฉพาะ key ของ fapony ใน opencode.json/c
- dogfood บน session ของ fapony เอง (cross-check กับ raw SQL ตรงๆ)

**ไม่ทำ:**
- ไม่เขียน opencode.db (read-only เท่านั้น)
- ไม่เก็บ message content / diff / source code ลง fapony db — aggregate เท่านั้น
- ไม่ทำ daemon, gateway, หรือ executor อื่น (นอก opencode)
- ไม่ทำ plugin สำหรับ Claude Code / Codex (scope รอบนี้ = opencode เท่านั้น)

## 3. Done criteria (รู้ได้อย่างไรว่าเสร็จ)

- `fapony stats` แสดง `usage` section ที่ token/cost ตรงกับ `sqlite3 opencode.db "SELECT SUM(tokens_input) FROM session WHERE ..."`
- MCP tool `passive_usage` คืนค่า aggregate ได้ถูกต้องผ่าน inspector
- `fapony install --platform opencode --dry-run` แสดง diff โดยไม่เขียนไฟล์จริง
- `fapony install --platform opencode` ซ้ำ 2 ครั้ง ไม่มีการเปลี่ยนแปลงครั้งที่ 2 (idempotent)
- ทุก test + lint + typecheck ผ่าน
- PLAN-verification-report step 6 ถูก cover ผ่าน dogfood → ปิดได้พร้อมกัน

## 4. ข้อห้าม (ห้ามละเมิด)

- ห้ามเขียน/แก้ไข opencode.db — read-only access เท่านั้น
- ห้ามเก็บ message content, source code, diff เต็มลง fapony db — aggregate เท่านั้น (กฎใหม่)
- ห้าม claim token/count จาก agent report — ต้องมาจาก client DB เท่านั้น (machine-observed)
- ห้ามแตะ key อื่นใน opencode.json/c — แตะเฉพาะ `mcp.fapony` เท่านั้น
- ห้ามเพิ่ม runtime dependency — ใช้ bun:sqlite + node:fs ที่มีอยู่แล้ว (กฎข้อ 1 ของ repo)
- ห้ามเขียนไฟล์ลง worktree เป้าหมาย — db อยู่ ~/.config/fapony/ เท่านั้น (กฎข้อ 5 ของ repo)

## 5. ความเสี่ยง & ทางหนี

| risk | likelihood | impact | escape hatch |
|------|------------|--------|--------------|
| schema opencode.db เปลี่ยนทีหลัง | กลาง | query พัง | ตรวจ schema ตอน runtime + log warning; ไม่ hardcode column ที่ไม่จำเป็น |
| opencode.db ถูกล็อก (WAL busy) | กลาง | อ่านไม่ได้ | รันด้วย `PRAGMA busy_timeout`; ล้มเหลว → ใช้ cache ล่าสุด + log warning |
| user ไม่มี opencode.db (ไม่ได้ใช้ opencode) | ต่ำ | ไม่มีข้อมูล | คืน empty result + log info ไม่ใช่ error |
| project_id join ผิด (หลาย worktree ชนกัน) | ต่ำ | วัดซ้อน | match ด้วย exact worktree path จาก `project.worktree` |
| install ทับ config user | กลาง | user โกรธ | แตะเฉพาะ `mcp.fapony` key + --dry-run ก่อนทุกครั้ง |

## 6. ขั้นตอน (เรียงลำดับ แต่ละขั้น verify ได้)

**0. Schema investigation** — query opencode.db schema จริง: ตรวจว่า `session` table มี field ไหนบ้าง, `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, `tokens_cache_write`, `cost`, `model`, `agent` มีจริงไหม, `project_id` join `project.worktree` ได้ไหม, ข้อมูล sample 5 แ�ววแรก → verify: document field inventory + ชื่อ field จริง + sample 3 แถว

**1. Write spec** (`spec/SPEC-passive-usage.md`) — data model (opencode session schema → fapony usage aggregate), join logic, aggregate-only rule, provenance markers, MCP tool schema, install command behavior → verify: อ่านแล้วรู้ว่า implement อะไรโดยไม่ต้องถาม

**2. Session reader** (`src/session.ts`) — read opencode.db (read-only), match project_id to fapony worktree, extract aggregate token/cost/model per session window → verify: unit test กับ mock DB คืนค่า aggregate ถูกต้อง

**3. Enrich stats** — เพิ่ม `usage` section ใน StatsData: total tokens (in/out/reasoning/cache), total cost, by-model breakdown, by-session top-5 → verify: `fapony stats` แสดง usage section ตรงกับ raw SQL

**4. MCP tool** (`src/mcp/tools/usage.ts`) — เพิ่ม `passive_usage` tool, returns usage data for a worktree or all → verify: MCP inspector เรียกได้ + ข้อมูลตรง

**5. Dogfood** — รัน `fapony stats` + `passive_usage` tool บน session ของ fapony เอง, cross-check กับ `sqlite3 opencode.db "SELECT ..."` ตรงๆ → verify: ตรงทุก field → ✅ PLAN-verification-report step 6 ถูก cover

**6. install --platform opencode** (`src/install.ts`) — เพิ่ม `fapony install --platform opencode`, idempotent, --dry-run, แตะเฉพาะ `mcp.fapony` key ใน opencode.json/c → verify: --dry-run แสดง diff; run จริง; run ซ้ำ ไม่มี change ครั้งที่ 2

**7. Test + lint + typecheck + bun run check** — ปิดจ็อบ → verify: เขียวทั้งหมด + dogfood log

## 7. ตัวอย่าง (ของจริงอยู่ใน spec)

ดูตัวอย่าง request/response ของ `passive_usage` tool + install command ใน [spec/SPEC-passive-usage.md](../spec/SPEC-passive-usage.md) (สร้างใน step 1) — plan นี้เก็บแค่ภาพรวม

## 8. References

- [ROADMAP.md](../ROADMAP.md) — P6 (active)
- [AGENTS.md](../AGENTS.md) § Plan Core — กฎเหล็ก 4 ข้อของ plan
- [src/db/store.ts](../src/db/store.ts) — SQLite access pattern (bun:sqlite)
- [src/mcp/tools/stats.ts](../src/mcp/tools/stats.ts) — ตัวอย่าง MCP tool implementation
- [src/mcp/tools/collect.ts](../src/mcp/tools/collect.ts) — ตัวอย่าง MCP tool ที่มี provenance marker
- `~/.local/share/opencode/opencode.db` — opencode session storage (real data)
