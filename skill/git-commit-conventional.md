---
name: git-commit-conventional
description: Commit split by concern with conventional message — use with Claude Code / OpenCode / Codex / ZCode. Trigger on /git-commit and when the user asks to commit changes.
---

# Git Commit Conventional — split by concern per fapony rules

You are about to commit completed changes.
**Hard rule: 1 commit per concern** — never bundle multiple unrelated changes.

## Before commit

1. `git status --porcelain` — check for unexpected files (from other agents) — if found, STOP and report
2. `git diff --stat HEAD` — see what changed
3. Split concerns:
   - `feat: ...` (new feature)
   - `fix: ...` (bug fix)
   - `refactor: ...` (refactor, no behavior change)
   - `docs: ...` (documentation)
   - `chore: ...` (tooling, deps)
   - `test: ...` (add/fix tests)

## Format

```
<type>(<scope>): <subject — max 72 chars>

<body — what changed and why, max 76 chars per line>

Ref <PLAN-file if applicable>
```

### Examples

```
feat(kickoff): auto-detect PLAN-active.md

Before: fapony kickoff --plan plan/PLAN-foo.md
After: fapony kickoff (auto-detect from plan/PLAN-active.md)

Saves dev from remembering paths. Auto-detect falls back to
most-recently-modified PLAN-*.md if PLAN-active.md missing.

Ref PLAN-kickoff.md
```

## Rules

- **NEVER git push** — pushing waits for the user or the review gate
- **NEVER --amend** an existing commit unless explicitly authorized
- **NEVER --no-verify** in hooks that protect the tree
- If there's a conflict with main: STOP, report, don't merge yourself
- Conventional commit = prefix is max 1 word
