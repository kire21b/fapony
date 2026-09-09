# PLAN-config-schema-cleanup.md — remove the loop-era config schema residue

> **Status:** 📝 draft — รอ kickoff · **Owner:** delamind · **Created:** 2026-09-09
> **Source spec:** [spec/SPEC-config-schema-cleanup.md](../spec/SPEC-config-schema-cleanup.md)

---

## 1. Goal (why)

Wave 0-2 ([629b33c](../../../commit/629b33c)) ลบ CLI loop (`src/run/`, `src/loop/`, ฯลฯ) ไปแล้ว
แต่ `Config` schema (`db/types.ts`/`getters.ts`/`defaults.ts`/`load.ts`) ยังลากฟิลด์ของ
loop ค้างอยู่ — `executor`, `review.bigDiff/gate/prefilter`, `prompts`, `markers`, `plan`,
`planmv`, `display`, `defaults.timeoutMin`, `resilience` — ไม่มีใครอ่านแล้วแม้แต่บรรทัดเดียว
(ไล่ live-caller ยืนยันแล้วใน spec) ทิศทางตอนนี้ชัดว่า measure/verify ผ่าน MCP ล้วนๆ ("ใช้
mcp แบบนี้แหละเข้าได้ทุกที่") — schema ที่เหลือควรสะท้อนแค่สิ่งที่ MCP tools + `gate.ts` +
`cost.ts`/`stats.ts`/`telemetry.ts` อ่านจริง ไม่ใช่ทำเป็น optional field เผื่ออนาคตของ
ฟีเจอร์ที่ตายไปแล้ว

## 2. Scope (do / don't do)

**Do:**
- ลบฟิลด์ `Config` ที่ไม่มี live caller ตาม audit ใน spec (`executor`, `prompts`, `spec`,
  `markers`, `plan`, `planmv`, `display`, `defaults`, `resilience`, `review.bigDiff/gate/
  prefilter/autoLoop`, `paths.doneDir/linkScanDirs`, `roles.*.cmd/timeoutMin`)
- ลบ getter ที่ตายตามฟิลด์ (`db/getters.ts`), `DEFAULT_*` คู่กัน (`db/defaults.ts`)
- ลบ `getLastPlanUpdate()` (`db/store.ts`) และ `parseGateVerdict`/`parsePlanUpdate`
  (`src/parse.ts`) — marker-text parser ที่ไม่มี producer เหลือแล้ว
- ตัด B2 drift-warning + executor merge ใน `db/load.ts`
- ปรับ `fapony.config.example.json` + README § Config ให้ตรง schema ใหม่
- ปรับ test ที่พังตาม (`config.test.ts`, `parse.test.ts`, `db.test.ts`, `test/index.ts`)

**Don't do:**
- ไม่แตะ `worktrees`, `memory`, `review.maxRounds`, `pricing`, `telemetry`, `safety.deny`,
  `paths.stateDir/planDir/specDir/memoryEntry`, `roles.*.model` — ยังมี live caller จริง
- ไม่ลบ `cost.ts`'s `beginSpawn`/`endSpawn` (write path) แม้ตอนนี้ไม่มีใครเรียก — อยู่ในทิศทาง
  benchmark ที่กำลังจะมี MCP tool เขียน spawn event เข้ามาแทน loop เดิม เป็นคนละเรื่องกับ
  config schema cleanup รอบนี้ (แยกเป็น plan ของตัวเองถ้าจะทำ)
- ไม่ migrate `fapony.config.json` ของ user เดิม — คีย์เก่าที่หลุด schema แค่นอนเฉยๆ ใน object
  (`loadConfig` spread `...file` ไม่ throw), ไม่ต้องมี migration step

## 3. Done criteria (how we know it's finished)

- `bun run typecheck` ผ่าน (0 errors)
- `bun run lint` ผ่าน (biome clean)
- `bun fapony.ts test` ผ่านทั้งหมด (ไม่มี test ถูกลบเพื่อหลบ failure — ลบเฉพาะ test ที่ทดสอบ
  ฟิลด์/ฟังก์ชันที่ถูกลบไปจริง)
- `grep -rn "executor\|bigDiff\|promptFileFor\|parseGateVerdict\|parsePlanUpdate\|resilienceEnabled" src --include=*.ts`
  ไม่เจอ (ยกเว้นคอมเมนต์ที่อธิบายประวัติ ถ้ามี)
- README § Config อ่านแล้วตรงกับ `Config` interface จริง (manual check)

## 4. Constraints / Hard rules (must not violate)

- ห้ามลบฟิลด์ที่ยังมี live caller — grep ยืนยันก่อนลบทุกตัว (โค้ดอาจ drift จาก spec ตอนเขียน
  ไปแล้วถ้าเวลาผ่านมานาน — re-grep ที่จุดเริ่ม execute เสมอ)
- ห้ามลบ `beginSpawn`/`endSpawn`/`cost.ts` write path — นอก scope, ตรงข้ามทิศทาง benchmark
- ห้ามแก้ DB schema (`runs`/`events` tables) — งานนี้แตะแค่ config/parse layer
- `bun run typecheck && bun run lint && bun fapony.ts test` ต้องผ่านก่อน commit ทุกครั้ง (ตาม
  pre-commit hook ที่มีอยู่แล้ว)

## 5. Risks & Escape hatches (if it fails)

| Risk | Likelihood | Impact | Escape hatch |
|---|---|---|---|
| Live-caller audit ใน spec drift ไปแล้วจากตอนเขียน (โค้ดเปลี่ยนระหว่างนี้) | Medium | Compile break | Re-grep ทุกฟิลด์ก่อนลบจริง (ระบุไว้ใน step 1) ไม่เชื่อ spec เฉยๆ |
| ลบ getter ที่ test อื่นแอบอ้างอิงทางอ้อม (เช่นผ่าน `baseConfig()` spread) | Low | Test compile error | `tsc --noEmit` จับได้ทันที ก่อน runtime |
| README/config.example เขียนไม่ตรง schema จริงหลังตัด | Low | Doc drift (ไม่ crash โค้ด) | Diff `Config` interface กับ README bullet ทีละบรรทัดตอน step สุดท้าย |
| ตัด `roles.*.cmd/timeoutMin` แล้วดันมี integration ภายนอกพึ่งอยู่ (นอก repo นี้) | Low | Breaking change ให้ user ภายนอก | ระบุใน commit message ว่าเป็น breaking (`chore!:`) ตาม convention เดิมของ Wave 2 |

## 6. Steps (what in which order)

1. **Re-verify live callers** — re-run the grep loop in spec § Shape for every candidate
   getter/field against current `src/` (not test files). Diff against the spec table;
   update the spec if anything drifted. *Verify: printed grep output matches spec table.*
2. **Trim `src/parse.ts`** — drop `parseGateVerdict`, `parsePlanUpdate`, `PlanUpdate`.
   *Verify: `tsc --noEmit` shows only downstream errors (test files), not new ones in
   non-test `src/`.*
3. **Trim `src/db/store.ts`** — drop `getLastPlanUpdate`. *Verify: same.*
4. **Trim `src/db/types.ts`** — shrink `Config` per spec table. *Verify: `tsc --noEmit`
   error count only in `getters.ts`/`defaults.ts`/`load.ts`/tests (expected next steps).*
5. **Trim `src/db/getters.ts` + `src/db/defaults.ts`** — delete the 20 dead
   getter/DEFAULT_* pairs listed in spec. *Verify: `tsc --noEmit` clean on `src/`.*
6. **Trim `src/db/load.ts`** — drop B2 drift warning + dead-field merges. *Verify:
   `tsc --noEmit` clean on `src/`.*
7. **Fix tests** — `config.test.ts`, `parse.test.ts`, `db.test.ts`, `test/index.ts`: delete
   assertions/imports for removed exports (same pattern as Wave 2 — don't invent new
   coverage for dead code, just stop asserting it exists). *Verify: `tsc --noEmit` fully
   clean.*
8. **Update non-code** — `fapony.config.example.json`, README § Config. *Verify: manual
   read-through against `Config` interface.*
9. **Full gate** — `bun run typecheck && bun run lint && bun fapony.ts test`. *Verify: all
   three exit 0.*
10. **Commit** — `chore!:` prefix (breaking: config keys removed), list dropped fields in
    the body, same style as [629b33c](../../../commit/629b33c).

## 7. Examples

See [spec/SPEC-config-schema-cleanup.md § Examples](../spec/SPEC-config-schema-cleanup.md#examples)
for the before/after `Config.review` shape.

## 8. References

- [spec/SPEC-config-schema-cleanup.md](../spec/SPEC-config-schema-cleanup.md) — full
  field-by-field audit
- Commit [629b33c](../../../commit/629b33c) — Wave 0-2, the CLI loop removal this plan
  finishes cleaning up after
- [CLAUDE.md](../CLAUDE.md) — legacy banner already flags this doc as stale on the loop
