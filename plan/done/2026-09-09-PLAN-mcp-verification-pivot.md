> ✅ **shipped** (positioning + scaffold parts; step 3 descoped — see §6)

# PLAN-mcp-verification-pivot — ย้ายตำแหน่ง: loop orchestrator → MCP verification layer

> **Status:** shipped · **Owner:** delamind · **Created:** 2026-09-09 · **Amended:** 2026-09-09
> **Amendment:** ถอย headline จาก "verification" เป็น **measure-first** — measure = คำสัญญา
> หลัก (ship แล้ว, เถียงยากเพราะเป็นตัวเลขดิบ) · verify = tier บน โปรโมทหลัง harden evidence
> (fapony ไม่ได้ควบคุม flow ของ agent จึงแบก "verified ✅" เป็น promise หลักไม่ได้)
> **Source spec:** ไม่มี — งาน positioning + scaffold เล็ก รายละเอียดพอใน plan
> **Supersede:** [PLAN-readme-launch.md](../PLAN-readme-launch.md) (ยังให้ loop เป็น headline ร่วม — plan นี้แทนที่)
> **หลังปิด plan นี้:** loop code เองก็ถูกลบจริงทั้งชุดใน Wave 0-2 (commit 629b33c,
> ดู [PLAN-config-schema-cleanup.md](2026-09-09-PLAN-config-schema-cleanup.md)) — เกินกว่าที่ plan
> นี้ตั้งใจไว้ตอนแรก (§2 "ไม่ทำ" เขียนว่าจะไม่ลบ) แต่ทิศทางเดียวกัน ไม่ใช่ contradiction

---

## 1. เป้าหมาย (ทำไม)

ปรับตำแหน่ง fapony จาก "orchestrator ที่ไล่ execute → review → fix loop" เป็น
**measurement layer ผ่าน MCP (verification เป็น feature บนฐานนั้น)** — ตอบคำถาม
"agent ทำอะไรไปบ้าง ต้นทุน/รอบ/ผลลัพธ์เป็นยังไง ข้อเรียกร้องไหนพิสูจน์ได้" กับ coding agent
ใดก็ได้ โดยไม่ต้องรับ workflow ของ fapony ทั้งก้อน

**North star ที่ชัดขึ้น (2026-09-09):** dev คนเดียวมักสลับใช้หลาย agent จริง (opencode,
Claude Code, zcode ฯลฯ) — คุณค่าที่แตกต่างจาก dashboard ของแต่ละ agent เองคือ **ไม้บรรทัด
เดียวกันข้าม agent**: เห็น token/cost/pass-rate เทียบกันได้ว่า model ไหนคุ้มกับงานแบบไหน
แล้วเอาไปตัดสินใจจริง (ไม่ใช่ vibe) — ระยะไกลกว่านั้นคือข้อมูลสะสมพอจะสรุป "style" การทำงาน
ของ dev คนนั้นได้เอง (ใช้ model ไหนกับงานประเภทไหนบ่อย, cost ต่อ task type) แต่ต้องมี
per-task tagging ที่ดีกว่าตัวเลขรวมก่อนถึงจะทำได้จริง — ยังไม่ commit เป็น scope รอบนี้

เหตุผลเชิงกลยุทธ์ (จาก risk table + การถอย verify→measure 2026-09-09):
1. **ลด adoption friction** — MCP เป็นช่องเข้าถึง agent ทุกตัวโดยไม่ต้องเปลี่ยน workflow
   (ไม่ต้องรู้จัก loop ก่อนจึงจะมีประโยชน์)
2. **ตั้งรับ "เจ้าใหญ่ทำเอง"** — Cursor/Copilot ใส่ verification ในตัวได้ แต่วัดข้าม tool/model
   ด้วยไม้บรรทัดเดียวกันไม่ได้ เพราะเขาเป็นคู่กรณี — ตำแหน่งที่ยืนได้คือ neutral measurement
3. **measure = ภาระพิสูจน์ต่ำ** — fapony_stats/fapony_usage เป็นตัวเลขดิบจาก git/session log
   ship แล้ววันนี้ ไม่มี vendor เถียงได้ว่าไม่แฟร์ ขณะที่ "verified ✅" ผูก reputation เข้ากับ
   evidence allowlist ทุกจุด และ fapony ไม่ได้ควบคุม flow ของ agent อิสระ → verify ต้อง
   harden ก่อนจึงโปรโมทเป็นคำสัญญาได้ (ตอนนี้ติดป้าย beta)
4. **evidence allowlist มีแล้วแต่ user ต้องสร้างเอง** — init ต้อง scaffold ให้ ไม่งั้น
   verification_report ระดับ verified แทบไม่เกิดขึ้นจริง

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**
- README.md ใหม่ — pitch "measurement layer" นำ (stats/usage = ship แล้ว), verify เป็น tier
  บนติดป้าย beta, loop ย้ายไป section ท้าย (optional)
- `fapony init` scaffold `.fapony/evidence.json` (template static + comment กันใช้ผิด)
- ปิด PLAN-readme-launch เป็น superseded

**ไม่ทำ (ตอนเขียน plan นี้ — ดูหมายเหตุท้าย header ว่าอะไรเปลี่ยนไปหลังจากนั้น):**
- ~~dogfood [PLAN-verification-report.md](../PLAN-verification-report.md) step 6 บน
  standalone repo~~ — **descoped**: นี่คือ P2 gate work ("dogfood หลาย task category" ตาม
  [ROADMAP.md](../../ROADMAP.md) §P2) ซึ่ง ROADMAP เขียนไว้ชัดว่า "ห้ามเริ่ม P2/P3 เดิม
  เพียงเพราะ code พร้อม" — ไม่ใช่ scope ของ positioning plan นี้ ย้ายกลับไปรอคิว P2 แทน
- ~~ไม่ลบ/ทุบ loop code~~ — เกินจริง: loop ถูกลบทั้งชุดใน Wave 0-2 (คนละ plan, ดูหมายเหตุ header)
- ไม่รื้อ CLAUDE.md รอบนี้ — README นิ่งก่อนแล้ว sync ทีเดียว
- ไม่เขียน landing page / เว็บแยก
- ห้าม auto-detect command จาก repo (อ่าน package.json ฯลฯ) ตอน scaffold — เดาผิด =
  allowlist ปลอม อันตรายกว่าไม่มี
- ไม่โปรโมท "verified" เป็นคำสัญญาหลัก — รอ harden evidence + dogfood proof ก่อน
- ไม่เพิ่ม usage source อื่น (Claude Code, zcode, ฯลฯ) ให้ `fapony_usage` รอบนี้ — วันนี้อ่านจาก
  OpenCode session DB (`~/.local/share/opencode/opencode.db`) เท่านั้น ([src/session.ts](../../src/session.ts))
  README ต้องบอกตรงๆ ว่ายังไม่ครอบคลุมทุก agent — ห้ามปล่อยให้ pitch อ่านเหมือนวัดได้ทุกตัวแล้ว

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- ✅ README ย่อหน้าแรก pitch **measurement-first** (stats/usage ใช้ได้ทันที) + verify เป็น tier
  บนติดป้าย beta ชัดเจน
- ✅ README ย่อหน้าแรก pitch กับ agent ใดก็ได้ ไม่บังคับ loop
- ✅ MCP section ครบ 6 tools ตรงกับ [src/mcp/tools/](../../src/mcp/tools/) + ทุกลิงก์เปิดได้
- ✅ `fapony init` ใน temp dir ได้ `.fapony/evidence.json` + init ซ้ำ error ไม่ทับไฟล์เดิม
- ⬜→**descoped** dogfood standalone repo — ย้ายไป P2 backlog (ดู §2 "ไม่ทำ")
- ✅ `bun test` เขียว + คำสั่งทุกอันใน README ตรงกับ [fapony.ts](../../fapony.ts) จริง

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- คำสั่งใน README ต้องตรงกับ fapony.ts จริงทุกอัน — cross-check ก่อน commit
- MCP docs อยู่ที่ [docs/mcp-handcheck.md](../../docs/mcp-handcheck.md) — README link ไป ไม่ copy
- evidence.json template เป็น **static text** เท่านั้น — ไม่อ่าน config/repo มาแต่ง command
- scaffold ห้ามทับไฟล์ที่มีอยู่ (init ซ้ำ = error ตามเดิม)
- ห้าม duplicate เนื้อหากับ CLAUDE.md — README ลิงก์กลับ

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| README pitch เกินความจริง (tools/ความสามารถที่ยังไม่มี) | ต่ำ | สอนผิด เสียความเชื่อใจ | cross-check src/mcp/tools/ + รันคำสั่งจริงทุกอันก่อน commit |
| dogfood เจอ friction หนัก | กลาง | ตัวเลขไม่สวย | นี่คือ data ไม่ใช่ความล้มเหลว — gap list กลายเป็น backlog รอบถัดไป |
| scaffold ทับ evidence.json ของ user | ต่ำ | ข้อมูล user หาย | init ซ้ำ error อยู่แล้ว + test คุม |
| ผู้ใช้ loop เดิมหาวิธีใช้ไม่เจอ | ต่ำ (เกิดจริง) | ความงง | ~~เก็บ loop ครบใน section "Optional loop"~~ — loop ถูกลบทั้งชุดทีหลัง (Wave 0-2); README ปัจจุบันไม่มี section นั้นแล้ว |

## 6. ขั้นตอน (เรียงลำดับ แต่ละขั้น verify ได้)

1. ✅ **scaffold evidence.json ใน [src/init.ts](../../src/init.ts) + test** → verify: init ใน temp
   dir ได้ `.fapony/evidence.json` ตาม shape ใน [SPEC-verification-report.md](../../spec/SPEC-verification-report.md)
   + init ซ้ำไม่ทับ + `bun test` เขียว
2. ✅ **README refactor MCP-first** → verify: คำสั่งตรง fapony.ts, MCP table ครบ 6 tools,
   ทุกลิงก์เปิดได้
3. **descoped** ~~dogfood step 6 บน standalone repo~~ — P2 gate work ตาม ROADMAP, ไม่ใช่
   scope positioning plan นี้ (ดู §2/§3) รอเปิด P2 จริงค่อยทำ ไม่ใช่แปะไว้ที่นี่
4. ✅ **ปิด PLAN-readme-launch เป็น superseded** → verify: status ในไฟล์นั้นอัปเดตแล้ว
   ไม่มี pending plan ทำงานซ้อนกัน
5. ✅ **bun test + lint/typecheck** → verify: เขียวทั้งหมด

## 7. ตัวอย่าง (เห็นภาพ)

```markdown
# เดิม (loop-first)
fapony turns any coding agent into a multi-agent workflow …
execute → review → fix loop

# ใหม่ (verification-first)
fapony answers: did the work actually get done — and how do you know?
6 MCP tools, any agent, no loop required.
```

## 8. References

- [PLAN-readme-launch.md](../PLAN-readme-launch.md) — superseded โดย plan นี้
- [PLAN-verification-report.md](../PLAN-verification-report.md) — step 6 (dogfood standalone),
  descoped จาก plan นี้ กลับไปรอคิว P2 (ดู §2/§6)
- [SPEC-verification-report.md](../../spec/SPEC-verification-report.md) — evidence allowlist shape + edge cases
- [docs/mcp-handcheck.md](../../docs/mcp-handcheck.md) — MCP protocol + adapter examples
- [ROADMAP.md](../../ROADMAP.md) §เป้าหมาย, §P2 — north star + gate discipline ที่ step 3 ยึดตอน descope
- [src/session.ts](../../src/session.ts) — `readPassiveUsage()`, ตอนนี้ hardcode OpenCode DB path เดียว
  (backlog ยังไม่เขียน plan: เพิ่ม source Claude Code — session JSONL ที่ `~/.claude/projects/**/*.jsonl`
  มี `message.usage` ต่อ turn อยู่แล้ว โครงสร้างพอจะ map เข้า `ModelBreakdown` เดิมได้ — ต้อง
  dogfood ก่อนว่า cross-agent tuning มีคนใช้จริง ค่อยเปิด plan ใหม่)
- [PLAN-config-schema-cleanup.md](2026-09-09-PLAN-config-schema-cleanup.md) — loop code ตัวจริงถูกลบ
  ใน Wave 0-2 (629b33c) และ config schema ตามใน plan นั้น — เหตุการณ์ที่เกินกว่า scope เดิมของ
  plan นี้ (ดูหมายเหตุ header)
