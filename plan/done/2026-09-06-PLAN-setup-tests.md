# PLAN-setup-tests.md — คุม orchestration ของ setup.ts + update.ts ด้วย seam ขั้นต่ำ

> ✅ **shipped** (3bd221b)

> **Status:** ✅ done · **Owner:** delamind · **Created:** 2026-09-07 · **Revised:** 2026-09-07 (v2 — scope เดิม stale หลัง pure-extraction เสร็จแล้ว)
> **Source spec:** (ยังไม่มี — แกนงานเล็ก รายละเอียดพออยู่ใน plan + test cases ใน step 6)

---

## 1. Goal (why)

รอบก่อนแยก pure function ออกจาก `setup.ts`/`update.ts` แล้ว (`buildSetupConfig`,
`validateWorktreePath`, `shouldOverwriteConfig`, `parseTimeoutMinutes`, `parseDirtyLines`,
`formatDirtyBlock`, `shouldProceedAfterDirty`, `isUpToDate`) — เทสแล้ว 12+4 ตัว, ผ่านหมด

แต่ตัว **orchestration** (`cmdSetup`, `cmdUpdate`) เอง ยังเรียก `execSync`/`readline`/
`process.exit` ตรงๆ ข้างใน ไม่มี seam ⇒ branch ที่เป็นลำดับ if/else จริงไม่มี test คุมเลย

จุดเสี่ยงสุดคือ [src/update.ts:118-130](../../src/update.ts) และ
[src/update.ts:139-148](../../src/update.ts) — **stash-pop failure path** ที่เพิ่งแก้บั๊กไปเองใน
`c3a45a5` (เดิมกลืน error เงียบ) จุดนี้ไม่มีอะไรจับถ้าใครมาแก้ซ้ำแล้วพลาดอีกรอบ

## 2. Scope (do / don't do)

**Do:**
- Seam ขั้นต่ำ (ไม่ใช่ DI ทั้งกระบิ) เฉพาะจุดที่ `cmdSetup`/`cmdUpdate` เรียก I/O จริง:
  git command runner, `ask`/`prompt`, `process.exit`
  → พอสำหรับ replay ทุก branch โดยไม่แตะ stdin/git/process จริง
- เทส orchestration ใหม่ครอบคลุม 2 ไฟล์ (~14 ตัว):
  - `cmdUpdate`: not-a-repo exit, dirty+no, dirty+yes+pull-ok, dirty+yes+pull-fail+pop-ok,
    **dirty+yes+pull-fail+pop-fail (บั๊กเดิม)**, up-to-date (same sha), updated (new sha)
    + log range, lockfile-changed → bun install
  - `cmdSetup`: git missing exit, bun missing exit, invalid path exit, overwrite-n
    (ไฟล์เดิมไม่ถูกแตะ), overwrite-y (เขียนทับ), scaffold already-exists vs initProject throw
- พฤติกรรม user-facing output ไม่เปลี่ยนแม้บรรทัดเดียว

**Don't do:**
- ❌ `mock.module()` — runner เป็น custom (`test/index.ts`) ไม่ใช่ bun:test
- ❌ เพิ่ม dependency (zero-dependency rule)
- ❌ เปลี่ยน text แจ้งเตือน/ลำดับคำถามของ wizard
- ❌ Seam ครอบคลุม `fs`/`cwd` ด้วย — pure function ฝั่ง config-building เทสแยกแล้วไม่ต้องผ่าน I/O,
  ส่วน `writeFileSync`/`initProject` ปล่อยเทสผ่าน temp dir จริงพอ (มันเป็น I/O ที่ปลอดภัยจะรันจริงกับ temp)

## 3. Done criteria (how we know it's finished)

- `fapony test` ผ่านครบ: เดิม (16) + ใหม่ (~14) ไม่มีข้าม
- Branch stash-pop-fail มี test คุมแล้ว (regression guard สำหรับ `c3a45a5`)
- ไม่มี `execSync`/`readline`/`process.exit` เรียกตรงๆ ใน code path ที่ `cmdUpdate`/`cmdSetup`
  เดินตอนเทส (ทุกอันผ่าน seam)
- grep ไม่เจอ `mock.module` ใน test ใหม่

## 4. Constraints / Hard rules (must not violate)

1. ห้ามสร้าง abstraction ที่มี implementation เดียว — seam ต้องถูกใช้จริงทั้ง default path
   (production) และ test path เท่านั้น ไม่ generalize เกินสองจุดนี้
2. Seam ใหม่ต้องเล็กที่สุดที่ยัง cover branch ได้ — ถ้า field ไหนไม่ถูกเทสจริง ตัดทิ้ง
3. db/state อยู่ที่เดิม — เทสไม่เขียน `fapony.config.json` ที่ repo root
4. fake `prompt`/`ask` ต้องคืนค่าตามลำดับคำถามจริง (ไม่ใช่ mock แบบเดายาว)
5. `initProject()` ใช้ตามเดิม แค่ชี้ `worktreePath` ไป temp dir ตอนเทส cmdSetup happy path

## 5. Risks & Escape hatches (if it fails)

| risk | likelihood | impact | escape hatch |
|---|---|---|---|
| Seam ครอบทุกจุดจนกลายเป็น over-engineering | กลาง | ต่ำ | ถ้า field ไหนไม่ถูกใช้ในเทสจริง ตัดออกจาก interface |
| `process.exit` ยังหลุดเรียกตรงในจุดที่คิดว่า inject แล้ว | สูง | กลาง | grep `process\.exit` ทุกจุดใน `update.ts`/`setup.ts` ก่อนเขียนเทส ต้องเหลือ 0 จุดนอก seam |
| fake git runner ต้อง sequence คำตอบตามลำดับเรียกจริง (rev-parse → status → pull → log → diff) | กลาง | กลาง | ใช้ mock แบบ map จาก args string → ผลลัพธ์ แทน queue ตามลำดับ (ทนกว่าเวลาสลับลำดับเรียกในอนาคต) |
| เทส cmdSetup happy path ไปแตะ `initProject()` จริงบน temp dir แล้ว flaky ข้าม platform | ต่ำ | ต่ำ | ถ้า flaky ให้ตัด assertion เหลือแค่ "ไม่ throw" ไม่ต้องเช็ค scaffold ไฟล์ทุกไฟล์ |

## 6. Steps (what in which order)

1. **Seam สำหรับ `update.ts`** — เพิ่ม `UpdateDeps` (git runner แบบ map args→result, `prompt`,
   `exit`) + `cmdUpdate(deps = {})` ใช้ default จริงถ้าไม่ส่ง — verify: `fapony test` ผ่านของเดิมครบ
   + `fapony update` รันจริงในนี้เห็น flow เดิม
2. **เทส `cmdUpdate` 7 branch** (ตาม scope ข้างบน รวม stash-pop-fail) — verify: `fapony test` ผ่าน,
   ไม่แตะ git/stdin จริง
3. **Seam สำหรับ `setup.ts`** — เพิ่ม `SetupDeps` เฉพาะ `checkCmd`, `detectGitRoot`, `ask`, `exit`
   (ไม่รวม fs/cwd ตาม scope) + `cmdSetup(deps = {})` — verify: `fapony setup` รันจริงเห็น prompt เดิม
4. **เทส `cmdSetup` 6 branch** — verify: `fapony test` ผ่านครบ
5. **จบ — อัปเดต status เป็น ✅ + รัน `fapony gate`** — verify: test summary รวมไม่หาย

## 7. Examples (make it concrete)

Seam แบบ map args→result (ทนต่อการสลับลำดับเรียก git ในอนาคต):

```ts
export interface UpdateDeps {
  git: (args: string) => string;       // throws on failure — caller catches for gitQuiet-style calls
  prompt: (question: string, defaultVal?: string) => Promise<string>;
  exit: (code: number) => never;
}
const responses: Record<string, string | Error> = {
  "status --porcelain": " M src/a.ts",
  "stash pop": new Error("conflict"),  // ← the bug branch
};
const fakeGit = (args: string) => {
  const r = responses[args];
  if (r instanceof Error) throw r;
  return r ?? "";
};
```

## 8. References

- [src/update.ts](../../src/update.ts) — orchestration ที่ต้องตัด seam (จุดเสี่ยงสุด: stash-pop)
- [src/setup.ts](../../src/setup.ts) — orchestration ที่ต้องตัด seam
- [test/update.test.ts](../../test/update.test.ts) — pure-function tests เดิม ต่อยอด
- [test/setup.test.ts](../../test/setup.test.ts) — pure-function tests เดิม ต่อยอด
- [test/index.ts](../../test/index.ts) — runner ที่ต้องลงทะเบียนเทสใหม่
- กฎจาก [CLAUDE.md](../../CLAUDE.md) § Rules for AI Agents ข้อ 1 (ห้าม abstraction เดียว) + § Edge Cases
