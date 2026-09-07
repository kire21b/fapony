# PLAN-mcp-handcheck — handcheck ผ่าน MCP โดยไม่ต้อง adopt loop

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-07
> **Source spec:** (สร้างใน step 1 → [spec/SPEC-mcp-handcheck.md](../spec/SPEC-mcp-handcheck.md))

---

## 1. เป้าหมาย (ทำไม)

agent ภายนอก (Claude Code / OpenCode / Codex) ทำงานด้วย workflow ของตัวเองต่อไปได้ แต่เรียก
fapony ผ่าน MCP 3 tools เพื่อ verify งานก่อนส่ง — handcheck ที่ง่ายที่สุดคือเครื่องตรวจให้หมด
เหลือให้คนตัดสินแค่ judgment ที่เครื่องตอบไม่ได้

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- MCP server ผ่าน stdio (JSON-RPC: `initialize` → `tools/list` → `tools/call`) ให้ agent ตัวไหนก็เรียกได้
- 3 tools เท่านั้น: `handoff_collect` (รวม machine facts) → `handoff_check` (ตรวจ conformance) → `verdict_submit` (บันทึก pass/fail + reason code ลง SQLite)
- ล็อก vocabulary ก่อนสร้าง tool: reason-code enum + metric dictionary 1 หน้า + minimum pass evidence (ไม่งั้นข้อมูลที่เก็บเทียบกันไม่ได้ทีหลัง)
- กฎ provenance: check result ที่ agent อ้างมารับได้แต่ mark `unverified` จนกว่า fapony จะ re-run เองด้วย allowlist คำสั่งที่ user ประกาศไว้ — ไม่เชื่อ claim เป็น fact
- แยกผลตรวจเป็น 2 ชั้น: ชั้นเครื่อง (auto) กับชั้นคน (เหลือ 2–3 คำถาม judgment พร้อม evidence)
- adapter ตัวอย่าง 2 แบบที่ไม่ใช่ core ชุดเดียวกัน + ทดลองจริงบน repo ที่ไม่ใช้ fapony loop 1 ที่ (proof ว่า protocol เป็นกลางจริง)

**ไม่ทำ:**
- ไม่ใช้ official MCP SDK — เพิ่ม dependency ผิดกฎ zero-dep (เขียน JSON-RPC เอง ~100 บรรทัด)
- ไม่รับคำสั่ง shell อิสระจาก agent — ทุก command ผ่าน `assertSafe()` ไม่งั้น MCP กลายเป็นช่องโยนคำสั่งอันตราย
- ไม่ทำ `stats_query`, HTTP/SSE transport, auth — รอมีคนขอจริง (defer ตาม Phase 1 gate)
- ไม่ส่ง source/diff/plan/gate-note ออกนอกเครื่อง — tools คืน facts + verdict เท่านั้น

## 3. Done criteria (รู้ได้อย่างไรว่าเสร็จ)

- MCP client จริง (inspector หรือ Claude Code) เรียกครบ 3 tools ได้โดยไม่อ่านโค้ด fapony ก่อน
- `bun fapony.ts test` ผ่านทั้งหมด รวม test ใหม่ของ transport + 3 tools + conformance
- `bun run lint` และ `bun run typecheck` ผ่าน (ไม่มี dependency ใหม่ใน package.json)
- มีหลักฐาน G1: repo ที่ไม่ใช้ fapony loop ถูก verify ผ่าน 3 tools ได้ โดยเจ้าของ repo ไม่ต้องถามผู้สร้างทุกขั้น

## 4. ข้อห้าม (ห้ามละเมิด)

- ห้ามเพิ่ม runtime dependency — ใช้แค่ `bun:sqlite` + stdin/stdout ที่มีอยู่แล้ว
- ห้ามรับ-รันคำสั่งจาก agent โดยไม่ผ่าน `assertSafe()` (กฎข้อ 4 ของ repo)
- ห้ามเขียนไฟล์ลง worktree เป้าหมาย — state อยู่ SQLite เท่านั้น (กฎข้อ 5 ของ repo)
- ห้ามคืนเนื้อหา source/diff/plan ใน tool response — facts และ verdict เท่านั้น
- ห้ามเก็บ handoff text เต็มใน events — เก็บแค่ verdict + reason code + tail ที่ truncate แล้ว (กัน secret ของคนอื่นไหลเข้า SQLite)
- schema/tool response ต้อง backward-compatible — เพิ่ม field ได้ ห้ามเปลี่ยนความหมาย field เดิม (ไม่งั้นข้อมูลเก่าเทียบใหม่ไม่ได้)

## 5. ความเสี่ยง & ทางหนี

| risk | likelihood | impact | escape hatch |
|------|------------|--------|--------------|
| client แต่ละเจ้าคาดหวัง MCP version ต่างกัน | กลาง | เรียก tools ไม่ติด | pin แค่ methods ที่ใช้จริง 3 ตัว + test กับ inspector เป็นหลัก |
| agent ส่ง input ร้าย/เพี้ยนมา | สูง | รันคำสั่งอันตราย / db เสีย | validate input + `assertSafe()` + parameterized query เท่านั้น |
| protocol ผูกกับ workflow เราโดยไม่รู้ตัว | กลาง | คนนอกใช้ไม่ได้จริง (G1 ตก) | adapter + external trial ต้องทำจาก doc อย่างเดียว ห้ามเปิด core |
| reason-code enum เปลี่ยนทีหลัง | กลาง | ข้อมูลเก่าเทียบใหม่ไม่ได้ | ล็อกใน step 0, หลังนั้น additive-only (เพิ่มค่าได้ ห้ามเปลี่ยนความหมาย) |
| scope บวมอยากเพิ่ม tool ที่ 4, 5 | สูง | ไม่จบ | ตัดทุก tool ที่ไม่มีคนขอจริงไปรอบหน้า |

## 6. ขั้นตอน (เรียงลำดับ แต่ละขั้น verify ได้)

0. **ล็อก vocabulary** — reason-code enum + metric dictionary 1 หน้า (definition/source/limitation) + minimum pass evidence + ตัดสิน protocol format (canonical JSON, รับ markdown ด้วย) → verify: ตอบคำถามค้าง ROADMAP ข้อ 2/4/7 ได้เป็นลายลักษณ์อักษร
1. **เขียน spec** (`spec/SPEC-mcp-handcheck.md`) — input/output schema ของ 3 tools + example payload + conformance checklist บน vocabulary จาก step 0 → verify: อ่านแล้วรู้ว่า implement อะไรโดยไม่ต้องถาม
2. **stdio transport skeleton** — `initialize`/`tools/list`/`tools/call` + framing ผ่าน stdin/stdout → verify: inspector ต่อติด เห็นรายชื่อ 3 tools
3. **`handoff_collect`** — รับ commit range คืน machine facts (diff stat, commits) + check results พร้อม provenance (`verified`/`unverified`) + ชี้ส่วนที่ขาด → verify: รันกับ repo จริงแล้ว facts ตรงกับ `git` เอง
4. **`handoff_check`** — รับ handoff (JSON หรือ markdown markers เดิม) คืน conformance ทีละข้อ + เหตุผล → verify: feed handoff ดี/เสีย/ขาด แล้วผลถูกทั้ง 3 แบบ
5. **`verdict_submit`** — บันทึก verdict + reason code (จาก enum step 0) ลง events → verify: `fapony stats` เห็น run ที่มาจาก MCP
6. **dogfood บนงานตัวเอง** — เอา 3 tools ไป verify run จริงของตัวเองก่อน จดสิ่งที่ spec ไม่ครอบ → verify: มีบันทึกสิ่งที่ต้องแก้ spec กลับ (ไม่มี = ไม่ได้ลองจริง)
7. **adapter ตัวอย่าง 2 แบบ + protocol doc** — เขียนจาก doc อย่างเดียวห้ามเปิด core → verify: adapter รันผ่านโดยไม่แตะ core
8. **external trial (G1 จริง)** — verify ย้อนหลังบน repo ที่ไม่ใช้ fapony loop 1 ที่ โดยเจ้าของ repo ทำตาม doc เอง → verify: จบได้โดยไม่ถามผู้สร้างทุกขั้น
9. **test + lint + typecheck + `bun run check`** — ปิดจ็อบ → verify: เขียวทั้งหมด

## 7. ตัวอย่าง (ของจริงอยู่ใน spec)

ดูตัวอย่าง request/response ของทั้ง 3 tools ใน [spec/SPEC-mcp-handcheck.md](../spec/SPEC-mcp-handcheck.md) (สร้างใน step 1) —
plan นี้เก็บแค่ภาพรวม ไม่แปะ schema ตรงๆ

## 8. References

- [PHASE.md](../PHASE.md) Phase 1 (Handoff Protocol v1 + หลัก hand-check 5 ข้อ) และ G1 gate
- [ROADMAP.md](../ROADMAP.md) P0 (safety/measurement contract) + คำถามค้างข้อ 2/4/7 ที่ step 0 ต้องตอบ
- [src/handoff.ts](../src/handoff.ts) (gitFacts + parseHandoff — ของเดิมที่ tools จะ reuse)
- [src/parse.ts](../src/parse.ts) + [src/db/defaults.ts](../src/db/defaults.ts) (verdict ปัจจุบันเป็น free-text — enum จะล็อกใน step 0)
- [src/safety.ts](../src/safety.ts) (`assertSafe()` ที่ทุก tool ต้องผ่าน)
- [templates/SPEC.md](../templates/SPEC.md) (template ของ spec ที่ step 1 จะใช้)
