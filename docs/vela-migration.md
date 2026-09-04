# vela migration reference

> ประวัติ: fapony แยกออกมาจาก convention ที่ใช้อยู่แล้วใน wt-vela (opencode.json, .memory/mem.ts,
> .claude/hooks/guard-git.sh) ไฟล์นี้เก็บว่าอะไรย้ายมา อะไรไม่ย้าย และของเดิมหน้าตาเป็นยังไง —
> อ่านเมื่อสงสัยว่า "ทำไม fapony ถึงออกแบบแบบนี้" ไม่ใช่ทุกครั้งที่ทำงาน (ดู [CLAUDE.md](../CLAUDE.md)
> สำหรับ architecture ปัจจุบัน)

---

## Config: worktree key ของ vela

```json
{
  "worktrees": {
    "vela": "/Users/delamind/Project/innominix/wt-vela"
  }
}
```

## ไฟล์จาก wt-vela ที่ "ย้าย" มาใช้ (คัดลอก + ถอด vela ออก ไม่ใช่ git mv)

| From | To | หมายเหตุ |
|------|-----|---------|
| เกณฑ์ใน CLAUDE.md (route review, cap 2 รอบ, commit แยก concern) | `fapony.config.json` | สำคัญสุด — อยู่ในภาษาคน คนอื่นเอาไปใช้ไม่ได้ |
| opencode.json → instructions[3] (กฎ commit/no-push) | `prompts/execute.md` | ต่อท้ายทุก execution prompt |
| .claude/hooks/guard-git.sh | ฝังเป็นโค้ดใน `run.ts` | เป็นข้อความ = ไม่ enforce ต้องเป็น code |

## ไฟล์ที่ "ไม่ย้าย" (ยังอยู่ใน wt-vela)

| File | เหตุผล |
|------|--------|
| `.memory/mem.ts` | เรียกผ่าน config.memory.* shell template ไม่ใช่ import |
| `.opencode/plugins/memory-claims.ts` | ผูกกับ opencode plugin API ไม่ใช่หน้าที่ orchestrator |
| `.opencode/skill/scrutinize-fix/` | ✅ ported แล้ว → `prompts/scrutinize-fix.md` |

---

## Reference: vela .memory system

mem.ts เป็น CLI dispatch 62 บรรทัด + store/selectors/render/commands/ แยกไฟล์:
- **Log:** append-only JSONL ที่ `apps/<app>/.memory/log.jsonl`
- **Row kinds:** next, bug, decision, note, hold (work items) + close, claim, release, synced (lifecycle)
- **Agent stamp:** `MEM_AGENT` env (fallback: `USER`)
- **staleReport:** ตรวจ decisions ที่ใหม่กว่า spec's last commit, claims แก่กว่า 4 ชม.

## Reference: vela opencode.json

```json
{
  "instructions": [
    "apps/vela/CLAUDE.md",
    ".opencode/memory-enforce.md",
    "Always load code-review-graph MCP tools first",
    "Commit as you go split by concern, never push"
  ],
  "mcp": {
    "code-review-graph": { "command": ["npx", "code-review-graph", "serve", "--auto-watch"] }
  }
}
```

## Reference: vela scripts/commit.ts

AI-powered git commit message generator (108 บรรทัด):
- ใช้ `git diff --stat` + `git diff HEAD` ส่งให้ Claude Haiku 4.5 สร้าง conventional commit message
- สองโหมด: ถ้า message มาก่อน → commit ตรง, ไม่งั้น → generate แล้ว commit
