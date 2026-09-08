# PLAN-passive-usage — วัดค่า AI แบบ passive ไม่ต้องรอ agent เรียก

> **Status:** 📝 draft — รอ kickoff · **Owner:** delamind · **Created:** 2026-09-09
> **Source spec:** [spec/SPEC-passive-usage.md](../spec/SPEC-passive-usage.md) — ล็อกใน step 1

---

## 1. เป้าหมาย (ทำไม)

ทำให้ fapony **ได้ข้อมูลการใช้ AI (token, tool calls, ขั้นตอน, model) โดย agent ไม่ต้องทำอะไรเลย** —
อ่านจากฝั่ง client (opencode session logs หรือ plugin) แทนการรอให้ agent ยอมเรียก MCP
เพื่อแก้ risk #1 ของ PLAN-verification-report ("agent ไม่เรียก report — likelihood สูง")
และทำให้ fapony เป็นเจ้าของข้อมูลเองแบบเดียวกับ code-review-graph (hooks/watch — passive update)

บทบาทของแต่ละชั้นหลัง plan นี้: **passive collector** = ข้อมูลใช้จ่าย/พฤติกรรม (ได้เองเสมอ) ·
**MCP verification_report** = คุณภาพ/evidence/verdict (agent เรียก 1 ครั้ง) ·
**run/loop** = meter แม่นสุดจาก spawn (optional เมื่อต้องการ orchestration)

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**
- collector ที่อ่าน opencode session ของเครื่องนี้ (log parser หรือ plugin — ตัดสินใน step 1)
  แล้วเก็บลง `events` เป็น kind ใหม่แบบ additive — token ต่อ message, tool calls นับรวม
  (grep/read/edit ไปกี่ครั้ง), model, ขั้นตอนต่อ session
- `fapony usage` — สรุปการใช้งาน by tool / by day / by model + counts จาก events ที่เก็บได้
- `fapony install --platform opencode` — เขียน MCP config + inject กฎ "จบงานเรียก
  verification_report" ลง rules ของ repo ให้เอง (idempotent, ไม่ทับของ user)
- กำหนด provenance ชัด: ข้อมูลจาก client log = machine-observed · ข้อมูลที่ agent แจ้งเอง = unverified
- dogfood รอบเดียวครอบทั้ง plan นี้ + step 6 ของ PLAN-verification-report (repo standalone
  ไม่ใช้ loop → install → ทำ task จริง → ดู usage + report)

**ไม่ทำ:**
- ไม่ลบหรือแก้ run/loop — คงเป็น optional layer (meter ที่ได้ byte proxy จริงจาก spawn)
- ไม่ทำ daemon/watch รอบนี้ — เริ่มจาก collector ที่สั่งรันเองก่อน พิสูจน์ว่าข้อมูลใช้ได้แล้วค่อยว่า (กฎ #1)
- ไม่รองรับ CLI tool อื่น (claude/codex) — opencode อย่างเดียวที่ใช้จริง (กฎ #1)
- ไม่ทำ MCP gateway จับ tool call ต่าง server — การนับ tool ทำที่ฝั่ง client logs แทน
- ไม่เพิ่ม/แก้ตาราง DB — `events.data` additive-only ตามเดิม
- ไม่แตะ MCP tools เดิม 5 ตัวและ verification report contract

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- collector อ่าน session จริงของ opencode บนเครื่องนี้ได้ → `fapony usage` แสดง by tool /
  by day / by model + counts จาก session อย่างน้อย 5 อัน โดยไม่ต้องแตะ agent เลย
- `fapony install --platform opencode` รันบน repo ปลอดแล้ว opencode เห็น MCP fapony +
  กฎจบงานโดยไม่แก้มือ (รันซ้ำไม่ทับ config ที่ user แก้เอง)
- ทุก field ใน events.data ใหม่มี provenance label (machine-observed / unverified) และ
  ข้อมูลเดิมอ่านได้ครบ (regression test ผ่าน)
- dogfood: agent ทำ task จบ 1 งานบน standalone repo → ได้ usage summary + verification
  report โดย developer ไม่แก้ config มือเลยหลัง install
- `bun test`, `bun run lint`, `bun run typecheck` ผ่าน

## 4. ข้อจำกัด / กฎเหล็ก

- **ไม่เชื่อ agent ลอยๆ** — token/tool counts ต้องมาจาก client (log/plugin) เท่านั้น;
  อะไรที่ agent แจ้งเองติด `unverified` เสมอ (ต่อยอดกฎของ verification report)
- **ห้ามปัด token/cost ให้ดูเป็นค่าจริง** — ถ้า log ให้แค่ proxy ต้อง label estimated
  (กฎเดิมของ cost.ts ต่อ)
- **fapony ห้ามเขียนไฟล์ใน worktree เป้าหมาย** — install แตะเฉพาะ config ฝั่ง client
  (opencode.json / rules) และต้อง idempotent + ไม่ทับสิ่งที่ user เขียนเอง
- **ไม่เก็บเนื้อหา prompt/output เต็มลง db** — เก็บ aggregate (counts, tokens, model,
  timestamp, session id) — content อยู่ใน log ต้นทางเท่านั้น
- session format ของ opencode ไม่ใช่ contract สาธารณะ → parser ต้อง tolerant (field หาย
  = ข้าม field นั้น ไม่พังทั้ง run) และบันทึก version ของ opencode ที่ทดสอบ
- ข้อมูลเก่าใน `events.data` ต้องอ่านได้ — field ใหม่ additive-only

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| risk | likelihood | impact | escape hatch |
|---|---|---|---|
| opencode session format เปลี่ยนตาม version | กลาง | parser พังเงียบๆ | tolerant parser + บันทึก version ที่ทดสอบ + มีแผน B เป็น opencode plugin (official API) |
| agent ยังไม่เรียก verification_report แม้มีกฎ inject | สูง | ไม่มี verdict/quality | passive ยังให้ usage ครบ; verdict ทำ manual ผ่าน `fapony gate` ได้อยู่แล้ว |
| log ต้นทางมีเนื้อหาละเอียด (prompt/source) | กลาง | privacy | เก็บเฉพาะ aggregate + allowlist field ที่อ่าน, content ไม่ลง db |
| token จาก log เพี้ยนจาก provider จริง | กลาง | ตีความ cost ผิด | label estimated/proxy เสมอ + แสดง provenance ในทุก report |
| install ทับ config ที่ user ปรับเอง | กลาง | ความเสียหาย config | idempotent + แก้เฉพาะ key ของ fapony + `--dry-run` |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. **สำรวจและล็อก data source** — เปิด session storage ของ opencode จริง: ตำแหน่ง, format,
   field ที่มี (token usage? tool calls? model? timestamps?) เทียบทาง log-parser vs plugin
   → **done:** spec/SPEC-passive-usage.md ล็อก field mapping, provenance rules, event kind
   + เกณฑ์เลือก parser หรือ plugin พร้อมเหตุผล → verify: ตอบได้ว่า "grep ไปกี่ครั้ง / token
   เท่าไร" ได้มาจาก field ไหนของไฟล์ไหน
2. **ทำ collector** — parse session → เขียน events (kind ใหม่, additive) พร้อม provenance
   label → verify: รันกับ session จริง ≥5 อันได้ข้อมูล + test ด้วย fixture ครบ edge (field
   หาย / format คลาดเคลื่อน / session ว่าง)
3. **เพิ่ม `fapony usage`** — สรุป by tool / by day / by model + counts + token (labeled)
   → verify: อ่านจาก events ที่ step 2 เก็บแล้วแสดงตัวเลขตรงกับที่นับมือใน session ตัวอย่าง
4. **เพิ่ม `fapony install --platform opencode`** — เขียน MCP config + inject กฎจบงาน
   (idempotent, `--dry-run`, แตะเฉพาะ key ของ fapony) → verify: รันบน repo ปลอดแล้ว
   opencode โหลด MCP fapony ได้ + รันซ้ำไม่ duplicate + ทดสอบกรณีมี config เดิมของ user
5. **Dogfood ครั้งเดียวจบ 2 plan** — standalone repo → install → ให้ agent ทำ task จริง
   1 งานโดยไม่แก้ config มือ → บันทึก: agent เรียก verification_report เองไหม (ครอบ step 6
   PLAN-verification-report), friction กี่ขั้น, usage summary มีอะไรครบ/ขาด → verify: จบ
   flow ได้ไม่ต้องถามผู้สร้าง + มี gap list สำหรับรอบถัดไป
6. **ปิดจ็อบ** — README/docs (usage + install + ข้อจำกัด token label) + อัปเดตสถานะ
   PLAN-verification-report step 6 ให้ตรง → verify: `bun test`, `bun run lint`,
   `bun run typecheck` ผ่าน และคำสั่งใน docs ตรงกับ implementation

## 7. ตัวอย่าง (เห็นภาพ)

```text
opencode ทำงานเสร็จ (agent ไม่รู้ตัว) → fapony usage อ่าน session logs → เห็น token/tool/counts
repo ใหม่ → fapony install --platform opencode → MCP + กฎจบงานถูกเขียนให้เอง → agent เรียก report 1 ครั้ง
```

รายละเอียด field mapping / event kind / provenance contract อยู่ใน
[spec/SPEC-passive-usage.md](../spec/SPEC-passive-usage.md) — ล็อกใน step 1

## 8. อ้างอิง

- [PLAN-verification-report.md](PLAN-verification-report.md) — step 6 dogfood ถูกครอบโดย
  step 5 ของ plan นี้; MCP tools และ report contract ที่ต้อง reuse ไม่ duplicate
- `src/mcp/` — MCP server เดิม (5 tools) ที่ install command เขียน config ให้
- `src/cost.ts` — กฎ byte proxy/USD estimate labeling ที่ต้องต่อยอด ไม่ขัดกัน
- `src/db/store.ts` — events table (additive-only rule)
- [ROADMAP.md](../ROADMAP.md) — P1 gate (dogfood data) + สนามที่เลือก/ไม่เลือก
- [PHASE.md](../PHASE.md) — thesis measurement layer, ไม่ใช่ orchestrator
- [code-review-graph](https://github.com/tirth8205/code-review-graph) — pattern ที่ยืม:
  install command, passive update, แนบ value metric ทุก response (ตลาดต่างกัน — เขาวัด
  โครงสร้างโค้ด เราวัดงาน agent)
