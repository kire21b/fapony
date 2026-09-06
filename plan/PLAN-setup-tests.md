# PLAN-setup-tests.md — เทส setup.ts (ask / detectGitRoot / checkCmd / cmdSetup)

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-07
> **Source spec:** (ยังไม่มี — แกนงานเล็ก รายละเอียดพออยู่ใน plan + test cases ใน step 6)

---

## 1. Goal (why)

`src/setup.ts` มี I/O side-effect (readline, execSync, process.exit, fs) ฝังอยู่ข้างใน ทำให้ 4 ฟังก์ชันหลัก (`ask`, `detectGitRoot`, `checkCmd`, `cmdSetup`) เทสไม่ได้ — ตอนนี้เทสได้แค่ `splitCmd` 6 ตัว ต้องตัด seam เพื่อให้ mock ได้โดยไม่พึ่ง `mock.module` (bun-only แต่ brittle)

## 2. Scope (do / don't do)

**Do:**
- `SetupDeps` interface จาก `cmdSetup(opts)` ตัด seam (rl / exec / exit / cwd / fs)
- export `ask` `detectGitRoot` `checkCmd` ออกมาเทสยูนิตตรงๆ
- เทสใหม่ ~12 ตัวใน `test/setup.test.ts` + ลงทะเบียนใน `test/index.ts`
- พฤติกรรม `cmdSetup` ไม่เปลี่ยนแม้บรรทัดเดียว (user-facing output รวม)

**Don't do:**
- ❌ ใช้ `mock.module()` จาก bun:test — runner เป็น custom (test/index.ts) ไม่ใช่ bun:test; injection พอ
- ❌ เพิ่ม dependency ใดๆ (กฎ zero-dependency)
- ❌ เปลี่ยน text แจ้งเตือน / ลำดับคำถามของ wizard — จะเละกับ user ที่ใช้อยู่
- ❌ แตะ `initProject()` ใน `src/init.ts` — ใช้ตามเดิม แค่ชี้ worktreePath ไป temp dir ตอนเทส

## 3. Done criteria (how we know it's finished)

- `fapony test` ผ่านครบ ตัวเดิม (splitCmd 6) + ใหม่ (~12) ไม่มีข้าม
- `cmdSetup()` ไม่ใส่ deps → พฤติกรรมเดิมทุกกิ่ง (รันจริงแล้ว interface/output เหมือนเดิม)
- เทสทุกตัวไม่แตะ stdin จริง / ไม่เรียก execSync จริง / ไม่ exit process จริง
- grep ไม่เจอ `process.exit` หรือ `execSync` หลุดเรียกตรงๆ นอก deps ใน `src/setup.ts`

## 4. Constraints / Hard rules (must not violate)

1. ห้ามสร้าง abstraction ที่มี implementation เดียว — `SetupDeps` ต้องถูกใช้จริงทั้ง default path และ test path
2. db/state อยู่ที่เดิม — เทสไม่เขียน `fapony.config.json` ที่ repo root (ใช้ cwd() ที่ถูก inject ชี้ temp)
3. fapony ห้ามเขียนไฟล์ใน worktree เป้าหมายนอกจากผ่าน `initProject()` ตาม design ปัจจุบัน
4. fake rl ต้องมี `close()` (เทสลืมจะ error ตอน `finally { rl.close() }`)
5. เทสกับ db (`FAPONY_STATE_DIR`) — setup ไม่ยุ่ง db แต่ห้ามทับ production state หากมี side effect แอบแฝง

## 5. Risks & Escape hatches (if it fails)

| risk | likelihood | impact | escape hatch |
|---|---|---|---|
| deps เยอะเกิน → seam กลายเป็น over-engineering | กลาง | ต่ำ | ถ้า inject แล้ว dep บางตัวไม่ถูกเทสจริง ตัดออก (เช่น `exists` อาจรวมเข้า fs object เดียว) |
| `process.exit(1)` ยังเรียกในที่ที่คิดว่า inject แล้ว | สูง | กลาง | grep `process\.exit` ทุก emission ใน Step 1 ที่เอาข้างใน setup.ts ก่อนเขียนเทส |
| wizard มี flow branch ซ่อน (overwrite prompt / scaffold catch) ยังทดไม่ครบ | กลาง | ต่ำ | พอ flow หลักผ่าน step 6 เทส 2 กิ่งเพิ่มภายหลังได้ ไม่ block ship |
| `execSync` default ต้อง dispose encoding/stdio ให้คุยกันกับ fake exec signature | ต่ำ | ต่ำ | fake exec รับ command:string → string, throw หาก fail; default wrap execSync ให้ตรง signature นี้ |

## 6. Steps (what in which order)

1. **Refactor seam** — เพิ่ม `SetupDeps` + `cmdSetup(deps = {})`, export `ask`/`detectGitRoot`/`checkCmd`, แทนที่ call ตรงๆ ด้วย deps — verify: `fapony test` ผ่านตัวเดิมครบ + `fapony setup` รันจริง (dry) เห็น prompt เดิม
2. **ยูนิต ask/detectGitRoot/checkCmd** — เทส 6 ตัว: ask default-on-empty, ask trim, ask suffix; detectGitRoot throw→null, return→path; checkCmd true/false — verify: `fapony test` ผ่าน, ไม่ยุ่ง stdin/PATH จริง
3. **เทส cmdSetup (การไหล + กิ่ง)** — เทส ~6 ตัว: happy path (script answers + temp cwd + assert ไฟล์ config ที่เขียน), overwrite กิ่ง "n" (ไม่แตะไฟล์), overwrite กิ่ง "y" (เขียนทับ), checkCmd ล้ม (git ไม่มี / bun ไม่มี) → fake exit ได้รับ 1, memory y vs n ให้ wiring ต่างกัน — verify: `fapony test` ผ่านครบ
4. **จบ — อัปเดต status ของ plan เป็น ✅ + รัน `fapony gate`** — verify: test summary แสดงจำนวนรวมไม่หาย + config site ยังจ่ายปกติ

## 7. Examples (make it concrete)

ตัวแบบ seam — ดู spec รายละเอียด:

```ts
const deps = { rl: undefined, exec: defaultExec, exit: process.exit, cwd: process.cwd }
const rl = deps.rl ?? realRl() // fake: { question: (q, cb) => cb(answers[i++]) , close: () => {} }
```

## 8. References

- [src/setup.ts](../../src/setup.ts) — call-level ที่ต้องตัด seam
- [test/setup.test.ts](../../test/setup.test.ts) — เทสเดิม (splitCmd) ต่อยอด
- [test/index.ts](../../test/index.ts) — runner ที่ต้องลงทะเบียน
- กฎจาก [AGENTS.md](../../AGENTS.md) § Rules for AI Agents ข้อ 1 (ห้าม abstraction เดียว) + § Edge Cases
