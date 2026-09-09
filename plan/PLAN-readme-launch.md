# PLAN-readme-launch — README ใหม่ vendor-neutral + MCP-first

> **Status:** ⛔ superseded โดย [PLAN-mcp-verification-pivot.md](done/2026-09-09-PLAN-mcp-verification-pivot.md) (2026-09-09) —
> positioning เปลี่ยนจาก "MCP-first + loop co-headline" เป็น MCP verification layer เด็ดขาด
> · **Owner:** delamind · **Created:** 2026-09-05 · **Updated:** 2026-09-09
> **Source spec:** ไม่มี

---

## 1. เป้าหมาย (ทำไม)

README ปัจจุบัน (dev branch) ล้าหลัง — เขียนก่อน MCP server สร้างเสร็จ ตอนนี้ fapony มี
2 วิธีให้ agent ทำงาน: **CLI loop** (เดิม) และ **MCP server** (ใหม่, agent-agnostic) + verdict
6 grade + `fapony_stats` MCP tool. README ต้องสะท้อนความจริงนี้ ให้คนอ่านเห็นภาพว่าใช้กับ
เครื่องมือของตัวเองยังไงโดยไม่ต้องอ่านโค้ดก่อน

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- เขียน README.md ใหม่ — pitch vendor-neutral + MCP-first (ไม่ผูก opencode)
- เพิ่ม MCP section: `fapony mcp` quick start + 4 tools (handoff_collect, handoff_check, verdict_submit, fapony_stats)
- เพิ่ม Case 4 — MCP agent (Claude Code / OpenCode ที่เรียกผ่าน MCP แทน stdin)
- อัปเดต CLI section: ตัด `setup`/`ps`, เพิ่ม `mcp`, อัปเดต `gate` grade 6 ตัว
- อัปเดต verdict references: pass-excellent/pass-good/pass-adequate/pass/fail/uncertain
- เพิ่ม `fapony_stats` ใน CLI + stats section
- Link `docs/mcp-handcheck.md` จาก README
- Sync CLAUDE.md — เพิ่ม MCP architecture, verdict 6-grade, stats, plan template อัปเดต

**ไม่ทำ:**
- ไม่เขียน landing page หรือเว็บไซต์แยก
- ไม่รื้อ CLAUDE.md — คนละ audience (README = คนอ่านครั้งแรก, CLAUDE.md = agent ที่ทำงานต่อ)

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- README.md ย่อหน้าแรกพูดถึง "ทุก coding agent" ไม่ผูก opencode อย่างเดียว
- README มี MCP section พร้อม quick start + 4 tools
- CLI section ตรงกับ fapony.ts จริง (ไม่มี setup/ps, มี mcp, gate 6 grade)
- verdict references ใช้ 6-grade enum ทุกจุด
- CLAUDE.md sync กับ main — มี MCP architecture + verdict + stats
- ทุกลิงก์ใน README เปิดได้จริง

## 4. ข้อจำกัด / กฎเหล็ก

- ห้าม duplicate เนื้อกับ CLAUDE.md — README ลิงก์กลับไป CLAUDE.md สำหรับรายละเอียด
- คำสั่งทุกอันต้องตรงกับ fapony.ts จริง (เช็คก่อน commit)
- MCP docs อยู่ที่ `docs/mcp-handcheck.md` — README link ไป ไม่ใช่ copy มา

## 5. ความเสี่ยง & ทางหนี

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| CLI section เขียนไม่ตรงจริง | กลาง | สอนคนผิด | รัน `bun fapony.ts --help` เช็คก่อน commit |
| MCP tools list ไม่ครบ | ต่ำ | agent เรียก tool ไม่เจอ | cross-check กับ `src/mcp/tools/` |
| CLAUDE.md sync ไม่ครบ | กลาง | agent ทำงานผิด | diff main → dev แล้ว cherry-pick ส่วนที่ขาด |

## 6. ขั้นตอน

1. อัปเดต PLAN-readme-launch.md (plan นี้) — เพิ่ม MCP, verdict 6-grade, stats → verify: plan สะท้อนความจริง
2. อัปเดต README.md — MCP section + CLI + verdict + stats + link docs → verify: คำสั่งตรง fapony.ts
3. อัปเดต CLAUDE.md — MCP architecture + verdict + stats + plan template → verify: diff กับ main แล้วไม่มีส่วนสำคัญตกหล่น
4. รัน `bun test` + lint/typecheck → verify: เขียว

## 7. ตัวอย่าง

```bash
# CLI loop (เดิม)
fapony run myapp --plan .fapony/plan/PLAN-x.md
fapony gate <id> pass-good "clean implementation"

# MCP (ใหม่ — agent-agnostic)
fapony mcp   # stdio JSON-RPC → 4 tools
```

## 8. References

- `docs/mcp-handcheck.md` — MCP usage guide + adapter examples
- `src/mcp/` — MCP server implementation (transport, tools/)
- PLAN-mcp-handcheck, PLAN-verdict-protocol, PLAN-verdict-stats (shipped on main)
