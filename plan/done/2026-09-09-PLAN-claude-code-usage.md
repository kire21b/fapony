# PLAN-claude-code-usage.md — read Claude Code session usage in src/session.ts

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-09
> **Source spec:** none — small enough to stay in-plan (see §7)

---

## 1. Goal (why)
`fapony_usage` reads OpenCode (sqlite) and ZCode (sqlite) passive usage today, but not Claude Code —
the client this very session runs on. Add a third source so `fapony stats`/`fapony_usage` cover all
three agents a worktree might be driven by.

## 2. Scope (do / don't do)
**Do:**
- Add `readClaudeCodeUsage()` to `src/session.ts`, same signature shape as `readZcodeUsage()`
- Parse `~/.claude/projects/<encoded-cwd>/*.jsonl` (one dir per project path, one file per session)
- Aggregate tokens (input/output/cache_read/cache_creation) + model, from `message.usage` lines
- Wire it into `readPassiveUsage()`'s result as a third optional key (`claude_code`), same pattern as `zcode`
- Env override `FAPONY_CLAUDE_PROJECTS_DIR` (mirrors `FAPONY_ZCODE_DB`/`FAPONY_OPENCODE_DB`)

**Don't do:**
- No `detail` (tool/step breakdown) for Claude Code in v1 — JSONL has no `part` table equivalent,
  would need per-line tool_use scanning; add only if `fapony_usage(detail:true)` is asked for this source
- No cost estimate — Claude Code JSONL carries no `cost` field, leave `total_cost: 0` (same as ZCode)
- No cross-session dedup beyond file = session — matches existing OpenCode/ZCode model 1 file/row = 1 session

## 3. Done criteria
- `readClaudeCodeUsage(worktree, since, until)` returns real totals when run against this repo's own
  `~/.claude/projects/-Users-delamind-Project-fapony-wt-fapony/` dir
- Returns `EMPTY_RESULT` when the projects dir (or the matching project subdir) doesn't exist
- `bun test test/session.test.ts` passes with new cases added
- `fapony_usage` MCP tool response includes `claude_code` key alongside `zcode`

## 4. Constraints / Hard rules
- fapony never writes into `~/.claude/` — read-only, same as OpenCode/ZCode readers
- No new dependency — JSONL parsing is `readFileSync` + `.split("\n")` + `JSON.parse` per line, stdlib only
- Malformed/partial JSONL lines (a session mid-write) must not throw — skip the bad line, don't abort the file
- worktree → project dir mapping is exact path match (Claude Code encodes full cwd, `/` → `-`), not fuzzy

## 5. Risks & Escape hatches
| Risk | Likelihood | Impact | Escape hatch |
|------|-----------|--------|---------------|
| JSONL format changes across Claude Code versions | medium | usage undercounts silently | only read known-stable fields (`message.usage.*`, `message.model`, `cwd`, `timestamp`); unknown fields ignored, not required |
| Large project dirs (long-running repos) slow to scan | low | latency on `fapony_usage` call | read only files under the matched project dir, not all of `~/.claude/projects/` |
| Encoded-path collision (two cwds encode the same string) | very low | usage merged across two projects | accept — same class of edge case OpenCode/ZCode already have via exact string match |
| Path-traversal via a crafted `worktree` string reaching outside `~/.claude/projects/` | low | read outside intended dir | encode worktree with the same `/`→`-` transform, never accept a raw dir name |

## 6. Steps
1. **Add `readClaudeCodeUsage()`** in `src/session.ts` — resolve project dir from `worktree` (encode
   path same way Claude Code does: replace `/` with `-`), glob `*.jsonl`, read line-by-line, sum
   `message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`
   plus `message.usage.output_tokens_details.thinking_tokens` → `tokens_reasoning` (the field already
   exists on `ModelBreakdown`/`PassiveUsageResult`, just unfilled for this source otherwise), grouped
   by `message.model`. Verify: unit test against a fixture `.jsonl` file.
2. **Wire into `readPassiveUsage()`** — add `claude_code?: PassiveUsageResult | null` to
   `PassiveUsageResult`, populate it the same way `zcode` is populated today. Verify: `bun test`.
3. **Wire into MCP `fapony_usage` tool** (`src/mcp/tools/usage.ts`) if it currently special-cases
   `zcode` — check whether it already forwards `PassiveUsageResult` opaquely (likely no change needed).
   Verify: `mcp__fapony__fapony_usage` call shows `claude_code` key.
4. **Docs** — one line in CLAUDE.md's `src/session.ts` description (already says "reads OpenCode's
   session DB" — extend to mention Claude Code + ZCode, currently already stale re: ZCode too).

## 7. Examples
```bash
bun test test/session.test.ts
```
Fixture: a small hand-written `.jsonl` with 2 `message.usage` lines under a temp dir, pointed at via
`FAPONY_CLAUDE_PROJECTS_DIR` — same isolation pattern `FAPONY_ZCODE_DB` already uses in tests.

## 8. References
- [src/session.ts](../src/session.ts) — file being extended
- [test/session.test.ts](../test/session.test.ts) — existing OpenCode/ZCode test patterns to mirror
- [spec/SPEC-passive-usage.md](../spec/SPEC-passive-usage.md) — background on why sums happen in SQL,
  not fully applicable here (no SQL, JSONL) but same aggregation discipline applies
- [src/mcp/tools/usage.ts](../src/mcp/tools/usage.ts) — MCP tool surface to check for wiring
