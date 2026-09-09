# PLAN-claude-install.md — `fapony install --platform claude`

> ✅ **shipped** (5b54e11) · **Owner:** delamind · **Created:** 2026-09-09
> **Source spec:** ไม่มี — ห่อ `claude mcp add` ที่มีอยู่แล้ว รายละเอียดพอในนี้

---

## 1. เป้าหมาย (ทำไม)

`fapony install --platform opencode` ใช้งานได้แล้ว แต่ Claude Code (ที่คุณใช้ dogfood/dev อยู่
ทุกวัน) ต้อง add mcp server เอง — ทำให้ "measure ข้าม agent ที่ใช้จริง" (opencode + Claude Code)
เริ่มต้นไม่เท่ากัน ต้องให้ `fapony install --platform claude` ติดตั้งได้ในคำสั่งเดียวเหมือนกัน

## 2. ขอบเขต (ทำอะไร / ไม่ทำอะไร)

**ทำ:**
- เพิ่ม `--platform claude` ใน [src/install.ts](../src/install.ts) — shell out ไปที่
  `claude mcp add fapony -s user -- fapony mcp` (native CLI ของ Claude Code เอง ไม่เขียน JSON parser เอง)
- resolve absolute path ของ fapony checkout ก่อนเรียก (`ROOT = join(import.meta.dir, "..")` แบบเดียวกับ
  [src/update.ts](../src/update.ts)) เผื่อ `fapony` ยังไม่ได้ `bun link`
- `--dry-run` พิมพ์คำสั่งที่จะรัน ไม่รันจริง (ต่อ pattern เดิมของ opencode)
- idempotent check: เรียก `claude mcp get fapony` ก่อน ถ้ามีอยู่แล้ว → no-op พิมพ์ "already configured"
- อัปเดต README `fapony install` section + CLI table ให้มีสองบรรทัด (opencode / claude)

**ไม่ทำ:**
- ไม่เขียน JSON ของ Claude Code config เอง (`~/.claude.json`) — `claude mcp add` มี CLI ให้แล้ว
  เขียนเองซ้ำซ้อนและเสี่ยง format เพี้ยนเวลา Claude Code เปลี่ยน schema
- ไม่ทำ `--platform claude-desktop` แยก (Desktop ใช้ config คนละไฟล์) — รอ demand จริงก่อน
- ไม่ auto-detect ว่า `claude` binary อยู่ใน PATH หรือเปล่าแบบซับซ้อน — เช็คแค่ exit code จาก spawn
  แล้ว error message บอกตรงๆ ว่าไม่เจอ `claude` ให้ผู้ใช้ติดตั้งเอง

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- `fapony install --platform claude` ใน environment ที่มี `claude` CLI → `claude mcp list` เห็น `fapony`
- เรียกซ้ำ → "already configured" ไม่ error ไม่ duplicate entry
- ไม่มี `claude` ใน PATH → error message ชัดเจน ("claude CLI not found — install Claude Code first")
  ไม่ crash ด้วย stack trace
- `--dry-run` ไม่แตะ config จริง (เช็คด้วย `claude mcp list` ก่อน/หลังไม่เปลี่ยน)
- README `fapony install` ตรงกับ implementation จริงทั้งสอง platform
- `bun test` เขียว

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- ห้าม parse/เขียนไฟล์ config ของ Claude Code เอง — ผ่าน `claude mcp add`/`get` เท่านั้น
- คำสั่งที่ spawn ต้องผ่าน `assertSafe()` เหมือน spawn อื่นทุกจุดใน fapony (กฎข้อ 4 ใน [CLAUDE.md](../CLAUDE.md))
- ห้ามเขียนไฟล์นอก `~/.config/fapony/` เพิ่มเติม — งานนี้ไม่แตะ state ของ fapony เองเลย มีแต่เรียก `claude` CLI
- คำสั่งใน README ต้อง cross-check กับ [fapony.ts](../fapony.ts) จริงก่อน commit

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| `claude mcp add` เปลี่ยน flag/syntax ในเวอร์ชันถัดไป | กลาง | install command พังเงียบๆ | เช็ค exit code + stderr, error message ชัดว่า “verify `claude mcp add --help`” แทนเดา silent fail |
| ผู้ใช้ยังไม่ได้ `bun link` fapony | กลาง | `claude mcp add` ชี้ path ผิด agent เรียกไม่ได้ | resolve absolute path จาก `import.meta.dir` เสมอ ไม่พึ่ง PATH |
| `claude` ไม่อยู่ใน PATH (CI, headless) | ต่ำ | command fail | error message ชัด ไม่ crash, exit code ไม่ใช่ 0 |
| scope `user` ทับ config เดิมของผู้ใช้ที่ตั้ง fapony ไว้คนละ command | ต่ำ | สับสน ทำงานผิดตัว | เช็ค `claude mcp get fapony` ก่อน ถ้ามีอยู่แล้วและ command ต่าง ให้ถามก่อนทับ (ไม่ auto-overwrite เงียบๆ) |

## 6. ขั้นตอน (เรียงลำดับ แต่ละขั้น verify ได้)

1. **เพิ่ม `--platform claude` branch ใน [src/install.ts](../src/install.ts)** — spawn `claude mcp get fapony`
   เช็คสถานะก่อน → verify: unit test mock spawn ครอบ 3 เคส (ไม่มี / มีอยู่แล้วตรง / มีอยู่แล้วต่าง)
2. **spawn `claude mcp add fapony -s user -- fapony mcp`** (path แบบ absolute) → verify: รันจริงใน
   environment ที่มี `claude` CLI แล้ว `claude mcp list` เห็น `fapony`
3. **`--dry-run` + error handling เมื่อไม่มี `claude`** → verify: exit code ไม่ใช่ 0 + message ชัด,
   dry-run ไม่เปลี่ยน config จริง
4. **อัปเดต README** — `fapony install --platform opencode|claude` ทั้งสองใน quick start + CLI table
   → verify: คำสั่งตรงกับ implementation
5. **`bun test`** → verify: เขียว

## 7. ตัวอย่าง (เห็นภาพ)

```bash
# เดิม — ทำได้แค่ opencode
fapony install --platform opencode

# ใหม่ — เพิ่ม claude
fapony install --platform claude
# → shells out to: claude mcp add fapony -s user -- fapony mcp
# → ✓ mcp.fapony configured for Claude Code (user scope)
```

## 8. References

- [src/install.ts](../src/install.ts) — opencode implementation ที่ต้อง extend (pattern เดิม: idempotent + `--dry-run`)
- [README.md](../README.md) — Quick start §2 + CLI section ต้อง sync
- [PLAN-mcp-verification-pivot.md](PLAN-mcp-verification-pivot.md) — north star cross-agent measurement ที่ plan นี้เป็นหนึ่งใน pre-condition (วัด Claude Code ได้ ต้องติดตั้งง่ายก่อน)
