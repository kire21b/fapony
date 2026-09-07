# SPEC-mcp-handcheck.md — MCP handcheck (3 tools)

> **Used by:** [PLAN-mcp-handcheck.md](../plan/PLAN-mcp-handcheck.md)

---

## Shape (data / API / schema)

### Transport

stdio JSON-RPC, MCP protocol version `2025-03-26`. Server reads newline-delimited JSON
from stdin, writes newline-delimited JSON to stdout. No HTTP/SSE, no auth.

### Tool inventory

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `handoff_collect` | Collect machine facts from git | `base_sha`, `head_sha`, `worktree` | facts + checks |
| `handoff_check` | Verify handoff conformance | `handoff` (text), `facts` (from collect) | conformance results |
| `verdict_submit` | Record verdict + reason | `run_id`, `verdict`, `reason_code`, `note?` | stored event |

### `handoff_collect` — input

```jsonc
{
  "base_sha": "abc123",     // required — git base for diff
  "head_sha": "def456",     // required — git head for diff
  "worktree": "/path/to/repo" // required — absolute path to git worktree
}
```

### `handoff_collect` — output

```jsonc
{
  "facts": {
    "files_changed": 3,
    "lines_changed": 120,
    "insertions": 80,
    "deletions": 40,
    "commits": ["a1b2c3d", "e4f5g6h"],
    "branch": "feature/auth",
    "git_error": null          // or error string if git failed
  },
  "checks": {
    "has_test_changes": true,  // diff includes files matching *test* or *spec*
    "has_docs_changes": false  // diff includes *.md files
  },
  "provenance": {
    "verified": true,          // facts come from fapony running git directly
    "source": "git_cli"
  }
}
```

### `handoff_check` — input

```jsonc
{
  "handoff": "## HANDOFF\nclaimed: ...\nchecks: ...",  // required — raw handoff text
  "facts": { /* from handoff_collect output */ },       // optional — if omitted, skip fact cross-reference
  "plan_ref": "PLAN-foo.md"                            // optional — for plan-scope check
}
```

### `handoff_check` — output

```jsonc
{
  "checks": [
    {
      "name": "has_handoff_block",
      "pass": true,
      "note": ""
    },
    {
      "name": "claimed_matches_commits",
      "pass": true,
      "note": "claimed commit a1b2 found in git log"
    },
    {
      "name": "uncertain_not_empty",
      "pass": false,
      "note": "executor flagged uncertainty about auth flow"
    },
    {
      "name": "not_done_not_empty",
      "pass": false,
      "note": "executor reported incomplete: tests"
    },
    {
      "name": "checks_declared",
      "pass": true,
      "note": "checks field present"
    },
    {
      "name": "facts_cross_referenced",
      "pass": true,
      "note": "2 commits in handoff match git log"
    }
  ],
  "summary": {
    "total": 6,
    "passed": 4,
    "failed": 2,
    "needs_human_review": true
  }
}
```

### `verdict_submit` — input

```jsonc
{
  "run_id": 42,                    // optional — if omitted, a new run is auto-created
  "verdict": "pass",               // required — "pass" | "fail"
  "reason_code": "missing_test",   // required — from ReasonCode enum
  "note": "needs integration test" // optional — required when reason_code = "other"
}
```

### `verdict_submit` — output

```jsonc
{
  "stored": true,
  "event_id": 15,
  "run_id": 42,
  "verdict": "pass",
  "reason_code": "missing_test"
}
```

### `reason_code` (enum)

```ts
type ReasonCode =
  | "missing_test"      // handoff อ้างว่า test ผ่านแต่ไม่มี test ใหม่ที่ครอบคลุม change
  | "scope_mismatch"    // diff ทำเกิน/ไม่ตรง plan ที่ตกลงไว้
  | "unsafe_command"     // handoff แสดงว่ามีคำสั่งที่ assertSafe() ควร block
  | "spec_gap"          // spec ไม่ครอบคลุม edge case ที่เจอ ไม่ใช่ความผิด executor
  | "other";            // ต้องมี note ประกอบเสมอเมื่อใช้ค่านี้
```

- append-only — เพิ่มค่าใหม่ได้ ห้ามเปลี่ยนความหมายค่าเดิม
- `note: string` (optional, required เมื่อ `reason_code === "other"`)

### Minimum pass evidence

ถึง verdict = "pass" ต้องมีอย่างน้อย:
1. `facts.files_changed > 0` หรือ `facts.commits.length > 0` (มีการเปลี่ยนแปลงจริง)
2. `checks.has_test_changes = true` (มี test ใหม่) — เว้นแต่ plan ระบุว่าไม่ต้องมี test
3. `handoff` block มี `claimed` และ `checks` fields
4. ไม่มี `uncertain` หรือ `not_done` ที่ไม่ resolve

ถ้าหลักฐานไม่ครบ → ให้ verdict = "fail" พร้อม reason_code ที่อธิบาย ไม่ใช่เดาเป็น pass

### Conformance checklist (handoff_check)

| Check | Description |
|-------|-------------|
| `has_handoff_block` | handoff text มี `## HANDOFF` marker |
| `claimed_matches_commits` | ถ้า handoff มี `claimed` commit hash ต้องตรงกับ git log |
| `uncertain_not_empty` | ถ้า executor รายงาน uncertainty → fail (ต้อง resolve ก่อน) |
| `not_done_not_empty` | ถ้า executor รายงาน not_done → fail (ต้องทำก่อน) |
| `checks_declared` | handoff มี `checks` field |
| `facts_cross_referenced` | commits ใน handoff ตรงกับ git facts |

### Provenance rule

check result ที่ agent อ้างมารับได้แต่ mark `unverified` จนกว่า fapony จะ re-run เองด้วย
allowlist คำสั่งที่ user ประกาศไว้ — ไม่เชื่อ claim เป็น fact

- `handoff_collect` facts = `verified` (fapony รัน git เอง)
- `handoff_check` results = `verified` (fapony ตรวจเอง)
- claims จาก agent ใน handoff text = `unverified` จนกว่า cross-reference จะยืนยัน

## Edge cases

| Scenario | Behavior |
|----------|----------|
| `worktree` path ไม่ใช่ git repo | `git_error` set, `facts` returned with zeros |
| `base_sha` ไม่เจอ | `git_error` set, partial facts (commits from HEAD) |
| `handoff` ไม่มี `## HANDOFF` block | `has_handoff_block` = fail, rest = skip |
| `run_id` ไม่มีใน DB | `verdict_submit` returns `{ stored: false, error: "run not found" }` |
| `reason_code = "other"` ไม่มี `note` | `verdict_submit` returns validation error |
| `facts` param omitted in `handoff_check` | `facts_cross_referenced` check is skipped entirely (not in checks array) |
| Agent ส่ง input ร้าย | `assertSafe()` + input validation ปฏิเสธ |

## Examples

### handoff_collect — normal

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "handoff_collect",
    "arguments": {
      "base_sha": "a1b2c3d",
      "head_sha": "e4f5g6h",
      "worktree": "/Users/dev/my-project"
    }
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"facts\":{\"files_changed\":3,\"lines_changed\":120,\"insertions\":80,\"deletions\":40,\"commits\":[\"a1b2c3d\",\"e4f5g6h\"],\"branch\":\"feature/auth\",\"git_error\":null},\"checks\":{\"has_test_changes\":true,\"has_docs_changes\":false,\"safety_violations\":[],\"dangerous_patterns\":[]},\"provenance\":{\"verified\":true,\"source\":\"git_cli\"}}"
    }
  ]
}
```

### handoff_check — failing (uncertainty reported)

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "handoff_check",
    "arguments": {
      "handoff": "## HANDOFF\nclaimed: a1b2c3d\ncommits: a1b2c3d e4f5g6h\nchecks: typecheck pass\nuncertain: the auth flow might need refactoring\nnot_done: none"
    }
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"checks\":[{\"name\":\"has_handoff_block\",\"pass\":true,\"note\":\"\"},{\"name\":\"claimed_matches_commits\",\"pass\":true,\"note\":\"claimed commit a1b2c3d found in git log\"},{\"name\":\"uncertain_not_empty\",\"pass\":false,\"note\":\"executor flagged uncertainty about auth flow\"},{\"name\":\"not_done_not_empty\",\"pass\":true,\"note\":\"no not_done items\"},{\"name\":\"checks_declared\",\"pass\":true,\"note\":\"checks field present\"},{\"name\":\"facts_cross_referenced\",\"pass\":false,\"note\":\"no facts provided for cross-reference\"}],\"summary\":{\"total\":6,\"passed\":4,\"failed\":2,\"needs_human_review\":true}}"
    }
  ]
}
```

### verdict_submit — success

**Request:**
```json
{
  "method": "tools/call",
  "params": {
    "name": "verdict_submit",
    "arguments": {
      "run_id": 42,
      "verdict": "pass",
      "reason_code": "missing_test",
      "note": "integration test needed for auth flow"
    }
  }
}
```

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"stored\":true,\"event_id\":15,\"run_id\":42,\"verdict\":\"pass\",\"reason_code\":\"missing_test\"}"
    }
  ]
}
```

### verdict_submit — run not found

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"stored\":false,\"error\":\"run not found\"}"
    }
  ]
}
```

### verdict_submit — validation error

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"stored\":false,\"error\":\"reason_code 'other' requires a note\"}"
    }
  ]
}
```
