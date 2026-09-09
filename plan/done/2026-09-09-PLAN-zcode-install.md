# PLAN-zcode-install.md — `fapony install --platform zcode`

> **Status:** ✅ shipped · **Owner:** delamind · **Created:** 2026-09-09
> **Source spec:** ไม่มี — ห่อ config JSON write ที่มีอยู่แล้ว รายละเอียดพอในนี้

---

## 1. เป้าหมาย (ทำไม)

`fapony install` รองรับ `--platform opencode` และ `--platform claude` แล้ว แต่ ZCode (ที่ใช้งานอยู่ทุกวัน) ยังไม่มี install command — ต้องแก้ `~/.zcode/cli/config.json` ด้วยตัวเอง ทำให้ "measure ข้าม agent" ไม่เท่ากัน ต้องให้ `fapony install --platform zcode` ติดตั้งได้ในคำสั่งเดียวเหมือนกัน

**North star จาก [PLAN-mcp-verification-pivot.md](2026-09-09-PLAN-mcp-verification-pivot.md):** dev สลับ use opencode, Claude Code, zcode — ไม้บรรทัดเดียวกันต้องเริ่มจากติดตั้งง่ายเท่ากันทุกแพลตฟอร์ม

## 2. ขอบเขต (ทำอะไร / ไม่ทำ)

**ทำ:**
- เพิ่ม `--platform zcode` branch ใน [src/install.ts](../../src/install.ts) — อ่าน/เขียน `~/.zcode/cli/config.json` ใต้ `mcp.servers.fapony` โดยตรง (เหมือน opencode pattern คือแก้ JSON เอง ไม่ได้ shell ออกไปที่ CLI)
- รองรับ fallback path `~/.agents/mcp.json` → `mcpServers.fapony` ตาม [ZCode Configuration Guide](~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/0.1.0/skills/zcode-configuration-guide/SKILL.md) — อ่าน `.zcode` ก่อน ถ้าไม่มีจึง fallback ไป `.agents/mcp.json`
- MCP entry เดียวกับแพลตฟอร์มอื่น: `{ "type": "local", "command": ["bun", "run", "fapony.ts", "mcp"] }`
- `--dry-run` พิมพ์ diff ก่อนเขียน (pattern เดียวกับ opencode)
- idempotent check: เรียก `zcode mcp get fapony` ถ้ามี CLI ให้; ถ้าไม่มีให้เช็ค JSON ใน config file โดยตรง
- `--platform zcode` ไม่ต้องเช็ค binary ว่าติดตั้งหรือเปล่า (zcode เป็น desktop app, ไม่มี CLI ให้ shell out เหมือน `claude`)
- อัปเดต README `fapony install` section + CLI table ให้มี 3 บรรทัด (opencode / claude / zcode)

**ไม่ทำ:**
- ไม่ shell ออกไปที่ `zcode` CLI — ZCode ไม่มี `zcode mcp add` เหมือน Claude; ต้องแก้ JSON config ตรงๆ
- ไม่เขียน JSON ของ ZCode config เองถ้า format ไม่ตรงกับ documented schema — ต้อง verify `~/.zcode/cli/config.json` schema ก่อน implement
- ไม่ทำ `--platform zcode-desktop` แยก — ใช้ config เดียวกัน
- ไม่ auto-detect workspace scope — work this plan สนับสนุนแค่ user scope (`~/.zcode/cli/config.json`) เหมือน claude `-s user`

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- `fapony install --platform zcode` ใน environment ที่มี `~/.zcode/cli/config.json` → `mcp.servers.fapony` ถูกเพิ่ม
- เรียกซ้ำ → "already configured" ไม่ error ไม่ duplicate entry
- `~/.zcode/cli/config.json` ไม่มีแต่ `~/.agents/mcp.json` มี → เขียนลง `.agents/mcp.json` แล้วบอก user ว่าใช้ fallback path
- ไม่มี config file ทั้งสอง → error ชัดว่า "ZCode config not found — open ZCode at least once to create config" ไม่ crash
- `--dry-run` ไม่แตะ config จริง
- README `fapony install` ตรงกับ implementation จริงทั้ง 3 platform
- `bun test` เขียว

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- ห้าม shell ออกไปที่ `zcode` CLI — ไม่มี CLI equivalent เหมือน `claude mcp add`
- คำสั่งที่ spawn ต้องผ่าน `assertSafe()` เหมือน spawn อื่นทุกจุดใน fapony (กฎข้อ 4 ใน [CLAUDE.md](../../CLAUDE.md))
- ห้ามเขียนไฟล์นอก `~/.config/fapony/` เพิ่มเติม — งานนี้ไม่แตะ state ของ fapony เอง
- ต้อง verify `~/.zcode/cli/config.json` schema จริงก่อน implement — schema ของ zcode อาจมี fields อื่นที่ต้อง preserve
- คำสั่งใน README ต้อง cross-check กับ [fapony.ts](../../fapony.ts) จริงก่อน commit

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| `~/.zcode/cli/config.json` schema ไม่ตรงกับที่เขียน | สูง | write แล้ว zcode ignore หรือ error | ก่อน implement: อ่าน config จริง + docs; หลัง write: validate ด้วย zcode restart |
| ZCode ไม่อ่าน config file ซ้ำ (cache ใน memory) | กลาง | MCP server ไม่แสดงแม้เขียนถูก | บอก user ให้ restart ZCode; เช็คด้วย Settings → MCP |
| ทั้ง `.zcode` และ `.agents/mcp.json` ไม่มี | กลาง | หาที่เขียน MCP ไม่ได้ | Error ชัดบอกให้เปิด ZCode ก่อน, ไม่สร้าง config ใหม่ |
| `--dry-run` ไม่รองรับ zcode ทำให้ plan ไม่สมบูรณ์ | ต่ำ | user ไม่เห็นภาพก่อนรัน | ทำ dry-run เหมือน opencode — print diff ก่อน |
| ZCode อัปเดตเปลี่ยน schema config | กลาง | install พังในเวอร์ชันถัดไป | เช็ค exit code / validate JSON; error message ชีว่า "verify ZCode config format" |

## 6. ขั้นตอน (เรียงลำดับ แต่ละขั้น verify ได้)

1. **Verify `~/.zcode/cli/config.json` schema** — อ่าน config จริงจาก environment นี้ + docs จาก [ZCode Configuration Guide](~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/0.1.0/skills/zcode-configuration-guide/SKILL.md) → verify: รู้จัก `mcp.servers` path และ schema ที่แน่นอน
2. **เพิ่ม `--platform zcode` branch ใน [src/install.ts](../../src/install.ts)** — อ่าน `~/.zcode/cli/config.json` (fallback `~/.agents/mcp.json`) → verify: unit test mock fs ครอบ 3 เคส (ไม่มีไฟล์ / มี `.zcode` / มีแค่ `.agents`)
3. **เขียน `mcp.servers.fapony` entry + idempotent check** → verify: รันซ้ำ → "already configured"; ตรวจสอบ JSON ไม่เสียรูป
4. **`--dry-run` + error handling เมื่อไม่มี config** → verify: exit code ไม่ใช่ 0 + message ชัด, dry-run ไม่เปลี่ยน config จริง
5. **อัปเดต README** — `fapony install --platform zcode` เพิ่มใน quick start + CLI table → verify: คำสั่งตรงกับ implementation
6. **`bun test`** → verify: เขียว

## 7. ตัวอย่าง (เห็นภาพ)

```bash
# เดิม — ทำได้แค่ opencode + claude
fapony install --platform opencode
fapony install --platform claude

# ใหม่ — เพิ่ม zcode
fapony install --platform zcode
# → แก้ ~/.zcode/cli/config.json:
#    mcp.servers.fapony = { "type": "local", "command": ["bun", "run", "fapony.ts", "mcp"] }
# → ✓ mcp.fapony configured for ZCode (user scope)
#    (restart ZCode to load the MCP server)
```

```json
// ~/.zcode/cli/config.json หลัง install
{
  "mcp": {
    "servers": {
      "fapony": {
        "type": "local",
        "command": ["bun", "run", "fapony.ts", "mcp"]
      }
    }
  }
}
```

## 8. References

- [src/install.ts](../../src/install.ts) — opencode + claude implementation ที่ต้อง extend (pattern เดิม: idempotent + `--dry-run` + JSON write)
- [README.md](../../README.md) — Quick start §2 + CLI section ต้อง sync ให้ครบทั้ง 3 platform
- [ZCode Configuration Guide](~/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-guide/0.1.0/skills/zcode-configuration-guide/SKILL.md) — `~/.zcode/cli/config.json` → `mcp.servers` schema + fallback `~/.agents/mcp.json` → `mcpServers`
- [PLAN-mcp-verification-pivot.md](2026-09-09-PLAN-mcp-verification-pivot.md) — north star cross-agent measurement ที่ plan นี้เป็นหนึ่งใน pre-condition (วัด zcode ได้ ต้องติดตั้งง่ายก่อน)
- [PLAN-claude-install.md](2026-09-09-PLAN-claude-install.md) — plan น้องที่ทำ `--platform claude` เสร็จแล้ว (pattern ที่ต้องทำซ้ำ)
