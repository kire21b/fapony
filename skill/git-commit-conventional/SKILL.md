---
name: git-commit-conventional
description: Commit split by concern with conventional message — use with Claude Code / OpenCode / Codex / ZCode. Trigger on /git-commit and when the user asks to commit changes.
---

# Git Commit Conventional — split by concern per fapony rules

You are about to commit completed changes.
**Hard rule: 1 commit per concern** — never bundle multiple unrelated changes.

## Before commit

1. `git status --porcelain` — in a shared/multi-agent worktree (e.g. fapony's `wt-*`), files
   already modified/untracked *before you touched anything this session* are usually earlier
   in-progress work from another session, not a problem — don't stop for those alone. Only
   STOP and report if something looks actively wrong: a file mid-edit that changes between two
   consecutive `git status` checks (another session writing right now — wait for it to settle,
   don't commit a moving target), or content you can't explain from this conversation's own
   history and that doesn't look like a coherent feature.
2. `git diff --stat HEAD` — see what changed
3. Split concerns:
   - `feat: ...` (new feature)
   - `fix: ...` (bug fix)
   - `refactor: ...` (refactor, no behavior change)
   - `docs: ...` (documentation)
   - `chore: ...` (tooling, deps)
   - `test: ...` (add/fix tests)

   When pre-existing uncommitted work (not yours) shares a file with your own edits, `git add
   -p` isn't available in this environment (interactive flags unsupported) — split at file-group
   granularity by concern instead of by line authorship. A few files or hunks may end up bundled
   with the concern they most belong to even if they predate your edits; say so in the commit
   body rather than forcing a line-level split you can't safely do.

## Format

```
<type>(<scope>): <subject — max 72 chars>

<body — what changed and why, max 76 chars per line>

Ref <PLAN-file if applicable>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
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

- **NEVER git push from this skill** — this skill only commits. Push/PR/merge is [git-pr-merge](../git-pr-merge/SKILL.md)'s job
- **NEVER --amend** an existing commit unless explicitly authorized
- **NEVER --no-verify** in hooks that protect the tree — if a pre-commit hook (lint/typecheck)
  fails on pre-existing code you didn't write, fix it for real (safe autofix + minimal manual
  fix) before committing rather than bypassing; note in the commit body that the fix wasn't
  purely for your own change
- If there's a conflict with main: STOP, report, don't merge yourself
- Conventional commit = prefix is max 1 word
