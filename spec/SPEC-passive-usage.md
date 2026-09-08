# SPEC-passive-usage — passive usage collection from opencode sessions

> **Used by:** [PLAN-passive-usage.md](../plan/PLAN-passive-usage.md)
> ล็อกใน step 1 ของ plan — field mapping, provenance rules, event kind, MCP tool schema,
> และ install command behavior ทั้งหมดอยู่ที่นี่ ไม่กระจายไปที่ implementation.

---

## Shape (data / API / schema)

### Opencode session log (source of truth)

opencode เก็บ session เป็นไฟล์ JSONL ที่ `~/.config/opencode/sessions/` (default path — อาจเปลี่ยนตาม version). แต่ละบรรทัด = 1 message ใน session:

```jsonc
// ตัวอย่าง message (schema คลาดเคลื่อนได้ — parser ต้อง tolerant)
{
  "id": "msg_abc123",
  "session_id": "sess_xyz",
  "project_id": "/Users/delamind/Project/fapony/wt-fapony",   // absolute path ของ worktree
  "role": "assistant",                      // "user" | "assistant" | "tool"
  "model": "opencode/glm-4.6",              // มีเมื่อ role="assistant"
  "usage": { "input_tokens": 1200, "output_tokens": 450 },  // อาจหาย
  "tool_calls": [{ "name": "grep", "arguments": { "pattern": "foo" } }],  // อาจหาย
  "timestamp": "2026-09-09T10:30:00Z"       // ISO 8601
}
```

**Field ที่ parser ต้องรู้ (allowlist):**

| field | type | required | ไม่มี = |
|-------|------|----------|---------|
| `session_id` | string | ✅ | ข้ามทั้งบรรทัด (ไม่รู้ session) |
| `project_id` | string (absolute path) | ✅ | ข้าม — join กับ worktree ไม่ได้ |
| `role` | string | ✅ | ข้าม |
| `model` | string | ❌ | model = null ใน aggregate |
| `usage.input_tokens` | number | ❌ | tokens = 0 (label estimated) |
| `usage.output_tokens` | number | ❌ | tokens = 0 (label estimated) |
| `tool_calls` | array | ❌ | tool_count = 0 |
| `timestamp` | string (ISO 8601) | ❌ | ts = null (กรอง by day ไม่ได้) |

### Join logic: session → worktree

```
session.project_id  ==  config.worktrees[<key>]   (exact match, absolute path)
```

- `project_id` เป็น absolute path ของ worktree — map กับ `fapony.config.json` → `worktrees` value
- ถ้า `project_id` ไม่ตรงกับ worktree ใดเลย → ข้าม session นั้น (ไม่ใช่งานของ fapony)
- ถ้า worktree เดียวกันมีหลาย session → รวมทุก session ที่ตรง

### Aggregate-only rule (ห้ามเก็บ content)

**เก็บได้ (aggregate):**
- token counts (input/output) — รวมทั้ง session
- tool call counts — รวมทั้ง session (แยกตาม tool name)
- session count, message count
- model (จาก assistant message ล่าสุด — ตามโครง session ส่วนใหญ่ใช้ model เดียว)
- timestamp range (first/last message ts)

**ห้ามเก็บ:**
- message content (prompt text, response text)
- tool call arguments (เก็บเฉพาะ count ต่อ tool name)
- session_id เต็ม (hash เป็น session_hash ก่อนเขียน — ปกป้อง identity)

### events.data shape (kind = "usage_passive")

```ts
interface UsagePassiveEvent {
  kind: "usage_passive";
  session_hash: string;       // sha256(session_id).slice(0,16) — ไม่เก็บ session_id เต็ม
  worktree: string;           // absolute path (join จาก project_id)
  model: string | null;       // จาก assistant message ล่าสุด
  tokens_input: number;       // รวมทั้ง session (0 ถ้า field หาย)
  tokens_output: number;      // รวมทั้ง session (0 ถ้า field หาย)
  tool_calls: Record<string, number>;  // { "grep": 12, "read": 5, ... }
  message_count: number;      // รวมทุก role
  started_at: string | null;  // ISO timestamp ของ message แรก
  ended_at: string | null;    // ISO timestamp ของ message สุดท้าย
  provenance: "machine-observed";  // ค่าตายตัว — ทุก field จาก client log
  parser_version: string;     // semver ของ parser ที่ใช้ (เช่ng "0.1.0")
  opencode_version: string | null;  // จาก session metadata ถ้ามี
}
```

- `kind` ใหม่นี้ **additive** — ไม่กระทบ event kind เดิม
- `provenance` คือ `"machine-observed"` เสมอ — ข้อมูลมาจาก client log โดยตรง ไม่ใช่ agent claim
- `parser_version` บันทึกไว้เพื่อ debug เมื่อ opencode format เปลี่ยน

### MCP tool `passive_usage`

```jsonc
// input
{
  "worktree": "/Users/delamind/Project/fapony/wt-fapony",  // optional — กรอง
  "since": "2026-09-01",     // optional — กรอง by started_at (YYYY-MM-DD)
  "until": "2026-09-30",     // optional — กรอง by started_at (YYYY-MM-DD)
  "by": "tool" | "day" | "model" | "session",   // default: "tool"
  "json": true | false       // default false
}

// output (ToolResult.text)
// json:true → JSON ล้วน
{
  "by": "tool",
  "worktree": "...",          // null ถ้าไม่กรอง
  "range": { "since": "...", "until": "..." },  // null ถ้าไม่กรอง
  "sessions": 12,             // จำนวน session ที่ aggregate
  "totals": {
    "tokens_input": 45000,
    "tokens_output": 18000,
    "tool_calls": 230,
    "messages": 890
  },
  "breakdown": [              // รายการตาม by=
    { "key": "grep", "tokens_input": 12000, "tokens_output": 0, "tool_calls": 85, "messages": 0 },
    { "key": "read",  "tokens_input": 8000,  "tokens_output": 0, "tool_calls": 42,  "messages": 0 },
    // ... by="tool" → key = tool name
    // by="day"   → key = "2026-09-09"
    // by="model" → key = "opencode/glm-4.6"
    // by="session" → key = session_hash
  ],
  "provenance": "machine-observed"
}

// json:false → text แบบ CLI (ดูตัวอย่างข้างล่าง)
```

### CLI `fapony usage`

```bash
fapony usage                          # ทุก worktree, by tool
fapony usage --by day                 # สรุปรายวัน
fapony usage --by model               # สรุปตาม model
fapony usage --by session             # สรุปต่อ session
fapony usage --worktree vela          # กรอง worktree
fapony usage --since 2026-09-01       # กรองวัน
fapony usage --until 2026-09-30
fapony usage --json                   # output JSON ล้วน
```

**Text output format:**

```text
usage (machine-observed) · 12 sessions · worktree: wt-fapony
range: 2026-09-01 → 2026-09-30

by tool:
  tool      | tokens_in | tokens_out | calls | sessions
  ----------|-----------|------------|-------|--------
  grep      |     12000 |          0 |    85 |       8
  read      |      8000 |          0 |    42 |      10
  edit      |      5000 |       2000 |    23 |       6
  ...

totals: 45000 tokens in / 18000 tokens out · 230 tool calls · 890 messages
```

### Install command: `fapony install --platform opencode`

**สิ่งที่ install ทำ:**

1. **เขียน MCP config** ลง `~/.config/opencode/opencode.json` (หรือ `opencode.jsonc`):
   ```jsonc
   {
     "mcp": {
       "fapony": {
         "command": "fapony",
         "args": ["mcp"]
       }
     }
   }
   ```
   - ถ้ามี key `mcp.fapony` อยู่แล้ว → **ไม่ทับ** (idempotent)
   - ถ้ามี key `mcp` อยู่แล้วแต่ไม่มี `fapony` → เพิ่ม `fapony` เข้าไป
   - ถ้า user แก้ args/command เอง → **เก็บค่าของ user** ไม่เขียนทับ

2. **Inject กฎจบงาน** ลง `.opencode/rules/` (ถ้ามี directory นี้):
   ```
   .opencode/rules/fapony-verification.md
   ```
   Content:
   ```markdown
   ## fapony verification
   เมื่อทำงานเสร็จหรือถูกสั่งหยุด → เรียก MCP tool `verification_report` 1 ครั้ง
   เพื่อปิดงานให้ fapony มีข้อมูลครบ (facts + evidence + verdict)
   ```
   - ถ้าไฟล์มีอยู่แล้ว → ตรวจว่ามี `## fapony verification` header → ข้าม (ไม่ duplicate)
   - ถ้าไฟล์มี content อื่น → เพิ่ม block นี้ต่อท้าย (ไม่ทับของเดิม)

3. ** `--dry-run` flag** — แสดงว่าจะเขียนอะไรที่ไหน โดยไม่เขียนจริง

**สิ่งที่ install ไม่ทำ:**
- ไม่แก้ `fapony.config.json` (เป็น config ของ fapony เอง ไม่ใช่ client)
- ไม่สร้าง worktree หรือแก้ไฟล์ใน worktree
- ไม่ start daemon หรือ watcher
- ไม่ inject กฎซ้ำ (idempotent)

---

## Edge cases (input → expected)

| input | expected |
|-------|----------|
| opencode session format เปลี่ยน field หาย | parser ข้าม field นั้น, aggregate ด้วยค่า 0/null — ไม่พังทั้ง run |
| session ไม่มี `usage` field | tokens_input = tokens_output = 0, provenance ยัง "machine-observed" |
| session ไม่มี `tool_calls` | tool_calls = {} (empty), tool_count = 0 |
| `project_id` ไม่ตรง worktree ใด | ข้าม session — ไม่ aggregate |
| session มี model หลายตัว (switch กลางทาง) | ใช้ model จาก assistant message ล่าสุด |
| ไฟล์ session log เสีย (JSON parse ไม่ได้) | ข้ามบรรทัดนั้น, log warning, ทำต่อ |
| ไม่มี session ในช่องวันที่กำหนด | คืน breakdown ว่าง + sessions = 0 |
| `fapony usage` ยังไม่เคยรัน collector | คืน "no usage data — run `fapony collect` first" |
| install ซ้ำ 2 ครั้ง | ไม่ duplicate MCP config, ไม่ duplicate กฎ — คืน "already installed" |
| user แก้ `mcp.fapony` เอง | install ไม่ทับ — เก็บค่า user |
| `--dry-run` | แสดง diff ของไฟล์ที่จะเขียน โดยไม่เขียนจริง |
| opencode ไม่มี directory `~/.config/opencode/` | install error: "opencode config dir not found" |
| `fapony usage --by session` มี session เยอะ (>100) | แสดงแค่ 50 แรก + "… and N more" — ไม่ dump ทั้งหมด |

---

## Examples

**รัน collector แล้วดู usage:**

```bash
$ fapony collect                          # parse session logs → events
parsed 12 sessions from 3 worktrees

$ fapony usage --by tool
usage (machine-observed) · 12 sessions
by tool:
  tool      | tokens_in | tokens_out | calls
  ----------|-----------|------------|------
  grep      |     12000 |          0 |    85
  read      |      8000 |          0 |    42
  edit      |      5000 |       2000 |    23
totals: 45000 tokens in / 18000 tokens out · 230 tool calls
```

**Install บน repo ใหม่:**

```bash
$ cd /path/to/repo
$ fapony install --platform opencode --dry-run
would write:
  ~/.config/opencode/opencode.json  → add mcp.fapony
  .opencode/rules/fapony-verification.md → create (4 lines)

$ fapony install --platform opencode
installed:
  ~/.config/opencode/opencode.json  → mcp.fapony added
  .opencode/rules/fapony-verification.md → created

$ fapony install --platform opencode   # รันซ้ำ
already installed (idempotent) — no changes
```

**MCP tool call จาก agent:**

```jsonc
// agent เรียบเหตุผลว่าใช้ token ไปเท่าไร
{ "name": "passive_usage", "arguments": { "by": "day", "since": "2026-09-01" } }
// → { "by": "day", "sessions": 12, "breakdown": [...], "provenance": "machine-observed" }
```

---

## Spec amendments (บันทึกไว้ที่นี่ ที่เดียว)

- ถ้า opencode เปลี่ยน session format ใหม่ → อัปเดต field mapping ใน §Shape + เพิ่ม `parser_version` ตาม
- ถ้ามี plugin API อย่างเป็นทางการ → เพิ่มทางเลือก plugin ได้ แต่ log parser ยังคงเป็น fallback
- field ใหม่ใน session log → ต้องเพิ่มใน allowlist ก่อน parser จะอ่าน
