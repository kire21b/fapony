# PLAN-plan-with-me — prompt pack + ตัวอย่าง + vendor-neutral export

> ✅ **shipped** (4a997d6)
> **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** ไม่มี (ต่อยอดจาก [ROADMAP.md](../../ROADMAP.md) § เดือนที่ 2)

---

## 1. เป้าหมาย (ทำไม)

`skill/plan-with-me.md` ตอนนี้เป็น skill เดียวลอยๆ ไม่มีตัวอย่างให้เห็นว่างานคนละแบบ (web app
ผิดจาก bug fix ตรงไหน) ต้องคุยต่างกันยังไง และผูกกับ Claude Code skill frontmatter อย่างเดียว
ทำให้ opencode ใช้ไม่ได้ตรงๆ งานนี้ทำให้มีตัวอย่างอ้างอิงได้จริง + เนื้อหาหลักแยกเป็น
vendor-neutral prompt ที่ agent ไหนก็กิน stdin ได้ (แบบเดียวกับที่ scrutinize-fix port มาแล้ว)

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- เขียนตัวอย่างบทสนทนา → PLAN จริง 3–5 แบบ: web app, CLI tool, refactor, bug fix, new feature
- แยกเนื้อหาหลัก (คำถามที่ต้องถาม + กฎ Plan Core) → `prompts/plan-with-me.md` (vendor-neutral)
- `skill/plan-with-me.md` เหลือเป็น thin wrapper ชี้ไปที่ prompt เดียวกัน ไม่ duplicate เนื้อหา
- README: เพิ่มตัวอย่างรัน plan-with-me ผ่าน opencode ตรงๆ (ไม่ผ่าน Claude Code skill)

**ไม่ทำ:**
- ไม่ auto-generate ตัวอย่างด้วย AI — เขียนมือ 3–5 อัน คุณภาพสำคัญกว่า quantity (งาน content)
- ไม่ทำ CLI flag เลือกประเภทงาน (`--type web-app`) — ตัวอย่างมีไว้ให้คนอ่านเทียบเอง ไม่ใช่ automation
- ไม่ผูก Codex เฉพาะตอนนี้ — ROADMAP เดือน 3 ถึงจะพูดถึง Codex ยังไม่ใช่ scope นี้

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- มีไฟล์ตัวอย่าง 3–5 ไฟล์ที่เป็น PLAN จริงผ่าน Plan Core section 1–4 ครบทุกไฟล์
- `opencode run < prompts/plan-with-me.md` ใช้ได้โดยไม่ต้องพึ่ง Claude Code skill frontmatter
- `skill/plan-with-me.md` เหลือแค่ pointer สั้นๆ ไม่ duplicate เนื้อหากับ prompts/
- README มี section ตัวอย่างการใช้กับ opencode พร้อมลิงก์ตัวอย่างทั้งหมด (ไม่ 404)

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- ตัวอย่างทุกอันต้องผ่าน Plan Core section 1–4 ครบ — ขาด section ห้าม merge (จะกลายเป็น
  ตัวอย่างสอนคนผิด)
- ห้าม duplicate เนื้อหาระหว่าง `skill/plan-with-me.md` กับ `prompts/plan-with-me.md` —
  แหล่งความจริงเดียว ตาม pattern ที่ scrutinize-fix วางไว้แล้ว
- ตัวอย่างต้องมาจาก use-case จริงหรือใกล้เคียงจริง ไม่ใช่ mock ลอยๆ ที่ไม่มีใครเทียบได้

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| ตัวอย่างเขียนแล้วไม่ตรง Plan Core จริง (section หาย) | กลาง | สอนคนผิด | เช็ค checklist มือทีละ section ก่อน commit |
| แยก prompt/skill แล้ว skill ใช้ไม่ได้ใน Claude Code จริง | ต่ำ | `/plan-with-me` พัง | ทดสอบเรียกจริงหลังแก้ก่อน commit |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. เขียนตัวอย่าง 1: **web app** (spec เยอะ, scope กว้าง) — verify: เทียบ checklist section 1–8
2. เขียนตัวอย่าง 2–3: **CLI tool**, **refactor** (สั้นกว่า, ไม่มี spec) — verify เหมือนกัน
3. เขียนตัวอย่าง 4–5: **bug fix**, **new feature** (เล็กสุด, เกณฑ์จบชัดมาก) — verify เหมือนกัน
4. แยก `prompts/plan-with-me.md` ออกจาก `skill/plan-with-me.md` — verify: diff เนื้อหาไม่ซ้ำกัน
5. README section ใหม่ + ลิงก์ตัวอย่างทั้ง 5 — verify: ลิงก์เปิดได้จริงทุกอัน

## 7. ตัวอย่าง (เห็นภาพ)

ตัวอย่างทั้ง 5 อยู่ใน [examples/](../../examples):

| ไฟล์ | ประเภท | ขอบเขต |
|------|--------|--------|
| [PLAN-webapp-notifications.md](../../examples/PLAN-webapp-notifications.md) | Web app | spec เยอะ, scope กว้าง (WebSocket + UI + backend) |
| [PLAN-cli-logger.md](../../examples/PLAN-cli-logger.md) | CLI tool | เล็ก, ไม่มี spec |
| [PLAN-refactor-auth.md](../../examples/PLAN-refactor-auth.md) | Refactor | มี code เดิม, ไม่มี feature ใหม่ |
| [PLAN-fix-race-condition.md](../../examples/PLAN-fix-race-condition.md) | Bug fix | เล็ก, เจาะจง |
| [PLAN-feature-export.md](../../examples/PLAN-feature-export.md) | New feature | scope กลาง |

## 8. อ้างอิง

- [skill/plan-with-me.md](../../skill/plan-with-me.md)
- [prompts/scrutinize-fix.md](../../prompts/scrutinize-fix.md) — pattern การ port skill →
  vendor-neutral prompt ที่จะทำตาม
- [CLAUDE.md](../../CLAUDE.md) — Plan Core template
- [ROADMAP.md](../../ROADMAP.md) — เดือนที่ 2
