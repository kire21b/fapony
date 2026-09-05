# PLAN-init-scaffold — `fapony init` + `fapony kickoff` + spec เป็น contract

> **Status:** ✅ shipped · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** ไม่มี (ต่อยอดจาก [ROADMAP.md](../ROADMAP.md) § สัปดาห์ 3–4)

---

## 1. เป้าหมาย (ทำไม)

ตอนนี้ทุก worktree ใหม่ต้องตั้ง `fapony.config.json` ด้วยมือ ไม่มีที่เก็บ `plan/`/`spec/`
มาตรฐาน และต้องพิมพ์ `--plan <path>` เต็มทุกครั้งแม้มี plan pending อยู่ไฟล์เดียว งานนี้ทำให้
scaffold โปรเจกต์ใหม่จบใน 1 คำสั่ง + รันก้อนถัดไปได้โดยไม่ต้องจำ path + spec ถูกอ่านเป็น
contract ก่อน executor เริ่มงานจริง

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- `fapony init <path>` — scaffold `plan/`, `spec/`, `.memory/` (reuse `copyDir` จาก
  [init-mem.ts](../src/init-mem.ts)) + marker ไฟล์เดียวใน `.fapony/`
- `fapony kickoff <worktree-key>` — หา plan ที่ยังไม่ shipped ใน `plan/` ให้เอง ถ้ามีใบเดียว
  รันเหมือน `fapony run <key> --plan <path>` เป๊ะ
- Memory adapter: `config.memory === null` แต่เจอ `.memory/mem.ts` จริงในเป้าหมาย → ใช้ default
  claim/close/add/kickoff แทนอัตโนมัติ (ของเดิมที่พิมพ์แนะนำอยู่แล้วใน init-mem.ts)
- Spec injection: ถ้า plan header มี `Source spec` ชี้ไฟล์จริง → ต่อท้าย prompt ก่อน spawn
  executor (จำกัดบรรทัดแบบเดียวกับ handoff truncation)

**ไม่ทำ:**
- ไม่ทำ interactive wizard ถาม-ตอบตอน init — one-shot scaffold พอ, wizard เพิ่มทีหลังถ้าคนใช้จริงบ่น
- ไม่ auto-detect worktree layout (monorepo/apps/*) — YAGNI จนกว่ามี use-case ที่ไม่ใช่ vela-style
- ไม่ทำ priority queue เมื่อเจอ plan pending มากกว่า 1 ใบใน kickoff — เดา priority อันตรายกว่าถามคน

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- `fapony init /tmp/x` สร้าง `plan/`, `spec/`, `.memory/{mem.ts,...}` ครบ + รันซ้ำ error ไม่ทับ
- `fapony kickoff <key>` เจอ plan pending ใบเดียว → รัน `runOnce` ได้ผลเหมือน `fapony run` เดิม
- `memory: null` + มี `.memory/mem.ts` จริง → claim/close ยังยิง (ไม่ต้องแก้ config)
- fixture plan มี `Source spec` → prompt ที่ส่งให้ executor มีเนื้อ spec แนบท้าย
- `bun run src/test.ts` เขียวครบ + เพิ่ม check ใหม่อย่างน้อย 3 ข้อ (init idempotent / kickoff
  auto-detect / memory default-wiring)

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- `fapony init` ห้ามเขียนทับไฟล์ที่มีอยู่แล้ว (เหมือน init-mem เดิม — error ชัดถ้าเจอของเก่า)
- `kickoff` ห้ามเดาเมื่อ ambiguous (>1 pending plan) — คืน error list ชื่อไฟล์ให้คนเลือกเอง
- `.fapony/` ในเป้าหมายคือ marker/local note เท่านั้น — ไม่ใช่ state.db (คนละหน้าที่กับ
  `~/.config/fapony/` ของ orchestrator เอง — ห้ามสับสน)
- "fapony ห้ามเขียนไฟล์ใน worktree เป้าหมาย" ยังคงอยู่สำหรับ `run`/`loop` — `init` เป็นข้อยกเว้น
  เฉพาะตอนคนสั่ง scaffold เองครั้งแรกเท่านั้น ไม่ใช่ agent loop
- reuse `copyDir` จาก init-mem.ts และ shipped-header regex จาก planmv.ts — ห้าม duplicate logic

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| `.fapony/` ความหมายไม่ชัด ซ้อนกับ state.db | กลาง | สับสนตอนใช้จริง | เขียน comment/README บรรทัดเดียวก่อน implement |
| kickoff auto-detect ผิดไฟล์ (regex header พลาด) | กลาง | รัน plan ผิด | reuse regex เดิมจาก planmv.ts ที่ทดสอบแล้ว ไม่เขียนใหม่ |
| spec injection ทำ prompt บวมเกิน context | ต่ำ | executor สับสน/แพง | ใช้ truncation pattern เดียวกับ handoff |
| memory default-wiring ชนกับคนตั้ง config.memory เองอยู่แล้ว | ต่ำ | double-claim | explicit config ชนะ default เสมอ — เป็นแค่ fallback ตอน null |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. **`src/init.ts`** — `fapony init <path>`: reuse `copyDir` (export จาก init-mem.ts) สร้าง
   `plan/`, `spec/`, `.memory/` + `.fapony/README` — verify: temp dir แล้ว `ls` ครบ, รันซ้ำ error
2. **`src/kickoff.ts`** — `fapony kickoff <worktree-key>`: scan `plan/*.md`, กรองด้วย
   shipped-header regex (reuse จาก planmv.ts), ==1 pending → เรียก `runOnce` เดิม, >1 → error list
   — verify: fixture 1 ใบผ่าน, 2 ใบ error พร้อมชื่อไฟล์
3. **Memory default-wiring ใน `src/memory.ts`** — `config.memory === null` +
   `existsSync(worktree/.memory/mem.ts)` → ใช้ default array เดิม (ดึงเป็น const ใช้ร่วมกับ
   init-mem.ts) — verify: test ตั้ง memory:null + fixture `.memory/mem.ts` → claim ยังยิง
4. **Spec injection ใน `src/run.ts`** — parse `Source spec` link จาก plan header, มีไฟล์จริง →
   ต่อท้าย prompt ก่อน spawn, truncate เหมือน handoff — verify: fixture plan มี Source spec →
   prompt มีเนื้อ spec
5. `bun run src/test.ts` เขียวครบ + sync [CLAUDE.md](../CLAUDE.md) (architecture tree, CLI
   commands, chunk roadmap)

## 7. ตัวอย่าง (เห็นภาพ)

```bash
# ก่อน
fapony run vela --plan plan/PLAN-foo.md --mem-id foo

# หลัง
fapony init /path/to/new-project      # ครั้งเดียวตอนเริ่มโปรเจกต์
fapony kickoff vela                   # auto หา plan pending เอง
```

## 8. อ้างอิง

- [src/init-mem.ts](../src/init-mem.ts) — copyDir + template source ที่ reuse
- [src/planmv.ts](../src/planmv.ts) — shipped-header regex ที่ reuse
- [ROADMAP.md](../ROADMAP.md) — สัปดาห์ 3–4
- [CLAUDE.md](../CLAUDE.md) — Plan Core template, Config Schema
