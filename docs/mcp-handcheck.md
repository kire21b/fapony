# MCP Handcheck Protocol — Usage Guide

> For external agents (Claude Code / OpenCode / Codex / any MCP client) that want
> machine facts about their work before submitting, without adopting fapony's loop.

## Quick Start

```bash
# Start the MCP server
fapony mcp

# It reads JSON-RPC from stdin, writes to stdout (newline-delimited)
```

## The 3-Tool Pipeline

```
handoff_collect  →  handoff_check  →  verdict_submit
     ↓                    ↓                 ↓
  git facts         conformance         store verdict
```

### 1. `handoff_collect` — Get machine facts from git

```json
{
  "method": "tools/call",
  "params": {
    "name": "handoff_collect",
    "arguments": {
      "base_sha": "abc123",
      "head_sha": "def456",
      "worktree": "/path/to/repo"
    }
  }
}
```

**Returns:** `facts` (files, lines, commits, branch) + `checks` (has_test, has_docs, safety) + `provenance` (verified)

### 2. `handoff_check` — Verify handoff conformance

```json
{
  "method": "tools/call",
  "params": {
    "name": "handoff_check",
    "arguments": {
      "handoff": "## HANDOFF\nclaimed: abc123\ncommits: abc123\nchecks: pass\nuncertain: none\nnot_done: none",
      "facts": { "commits": ["abc123"] }
    }
  }
}
```

**Returns:** `checks[]` (name, pass, note) + `summary` (total, passed, failed, needs_human_review)

**Checks performed:**
| Check | Passes when |
|-------|-------------|
| `has_handoff_block` | handoff contains `## HANDOFF` |
| `claimed_matches_commits` | claimed commit exists in commits list |
| `uncertain_not_empty` | no uncertainty flagged |
| `not_done_not_empty` | no incomplete items |
| `checks_declared` | checks field present |
| `facts_cross_referenced` | commits match git facts |

### 3. `verdict_submit` — Record the verdict

```json
{
  "method": "tools/call",
  "params": {
    "name": "verdict_submit",
    "arguments": {
      "run_id": 42,
      "verdict": "pass",
      "reason_code": "missing_test",
      "note": "needs integration test"
    }
  }
}
```

**Reason codes:**
- `missing_test` — claims test pass but no new test covers the change
- `scope_mismatch` — diff exceeds agreed plan
- `unsafe_command` — dangerous command detected
- `spec_gap` — spec doesn't cover edge case found
- `other` — requires `note` field

## Example: Claude Code Adapter

```bash
# In your Claude Code session, after writing code:

# Step 1: Collect facts
FACTS=$(echo '{"method":"tools/call","params":{"name":"handoff_collect","arguments":{"base_sha":"'"$BASE"'","head_sha":"'"$HEAD"'","worktree":"'"$PWD"'"}}}' | fapony mcp)

# Step 2: Build handoff and check it
HANDOFF="## HANDOFF
claimed: $(git rev-parse --short HEAD)
commits: $(git log --oneline $BASE..HEAD | awk '{print $1}')
checks: $(your-checks-here)
uncertain: none
not_done: none"

CHECK=$(echo '{"method":"tools/call","params":{"name":"handoff_check","arguments":{"handoff":"'"$(echo $HANDOFF | sed 's/"/\\"/g')"'","facts":'"$(echo $FACTS | jq -r '.result.content[0].text')"'}}}' | fapony mcp)

# Step 3: If checks pass, submit verdict
VERDICT=$(echo $CHECK | jq -r '.result.content[0].text' | jq -r '.summary.failed')
if [ "$VERDICT" = "0" ]; then
  echo '{"method":"tools/call","params":{"name":"verdict_submit","arguments":{"run_id":'$RUN_ID',"verdict":"pass","reason_code":"missing_test"}}}' | fapony mcp
fi
```

## Example: Python Adapter

```python
import json
import subprocess

class FaponyHandcheck:
    def __init__(self):
        self.proc = subprocess.Popen(
            ["fapony", "mcp"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
    
    def _call(self, method, params=None):
        msg = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())
    
    def collect_facts(self, base_sha, head_sha, worktree):
        r = self._call("tools/call", {
            "name": "handoff_collect",
            "arguments": {"base_sha": base_sha, "head_sha": head_sha, "worktree": worktree}
        })
        return json.loads(r["result"]["content"][0]["text"])
    
    def check_handoff(self, handoff, facts=None):
        args = {"handoff": handoff}
        if facts:
            args["facts"] = facts
        r = self._call("tools/call", {"name": "handoff_check", "arguments": args})
        return json.loads(r["result"]["content"][0]["text"])
    
    def submit_verdict(self, run_id, verdict, reason_code, note=None):
        args = {"run_id": run_id, "verdict": verdict, "reason_code": reason_code}
        if note:
            args["note"] = note
        r = self._call("tools/call", {"name": "verdict_submit", "arguments": args})
        return json.loads(r["result"]["content"][0]["text"])
    
    def close(self):
        self.proc.stdin.close()
        self.proc.wait()

# Usage
hc = FaponyHandcheck()
facts = hc.collect_facts("abc123", "def456", "/path/to/repo")
check = hc.check_handoff(handoff_text, facts)
if check["summary"]["failed"] == 0:
    result = hc.submit_verdict(run_id, "pass", "missing_test")
hc.close()
```

## Running the Server

```bash
# Via CLI
fapony mcp

# Via MCP config (e.g., Claude Desktop)
{
  "mcpServers": {
    "fapony": {
      "command": "fapony",
      "args": ["mcp"]
    }
  }
}
```

## Safety Rules

1. All git commands go through `assertSafe()` — dangerous patterns blocked
2. No source/diff/plan content in tool responses — only facts + verdict
3. Provenance: fapony-verified facts are `verified`, agent claims stay `unverified` until cross-referenced
4. Schema is backward-compatible — new fields added, old fields never changed
