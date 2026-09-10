---
name: git-pr-merge
description: Push the branch, open a PR with an AI-drafted title/body, and merge it — use with Claude Code. Trigger on /git-pr-merge, /pr, and when the user asks to open a PR, ship a branch, or merge for them.
---

# Git PR Merge — push, PR, merge in one go

You are shipping a branch: push it, open a PR with a drafted title/body, merge it.
Commits should already be split by concern — see [git-commit-conventional](../git-commit-conventional/SKILL.md)
if they aren't yet.

## Before anything

1. `git status --porcelain` — uncommitted changes? STOP, ask whether to commit first
2. `git branch --show-current` — refuse if this is `main`/`master` (or the repo's default branch):
   tell the user to branch first
3. `git log <default-branch>..HEAD --oneline` — the commits this PR will contain

## Draft

- **PR title**: one line, conventional-commit style (`feat: ...`, `fix: ...`), summarizing the
  whole branch — not just the last commit
- **PR body**: short summary of what changed and why (from the commit messages + diff, not
  invented), plus a one-line test plan if there's an obvious one (tests run, command output).
  End with:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```
- **Merge method**: squash, unless the branch already has meaningful separate commits worth
  keeping — then a regular merge. Ask if genuinely unclear.

## Confirm once, then run

Show the drafted title + body + merge method together and get one go-ahead — don't ask
separately for push, then PR, then merge. Then:

```bash
git status --porcelain   # re-check right before pushing, not just at the start —
                          # time passed drafting/waiting on CI; in a shared/multi-agent
                          # worktree another session may have added uncommitted work.
                          # If dirty, wait for it to be committed (or ask) before pushing —
                          # don't push around it and don't commit someone else's changes yourself.
git push -u origin <branch>
gh pr create --title "<title>" --body "<body>"
gh pr merge --squash   # or --merge, per the chosen method
```

## Rules

- **Never push to `main`/`master` directly** — always via PR
- **Never merge with failing CI** — check `gh pr checks` first; if red or pending, report and wait
- **Never `--admin` merge** (bypassing branch protection) unless the user explicitly says to
- **Never force-push** an existing PR branch without saying so first
- One PR per concern, same as commits — don't bundle unrelated branches into one PR

## If fail

- `gh` not authenticated → tell the user to run `gh auth login`
- Merge conflict with base branch → STOP, report, don't resolve unilaterally. Exception: if
  base was previously updated by squash-merging an earlier point of *this same branch* (common
  with a long-lived `dev` branch merged into `main` repeatedly), the "conflict" can be a false
  positive from mismatched history rather than real divergent content. Verify before touching
  anything: `git log branch..base --oneline` to see what base has that the branch doesn't, then
  diff each of those commits' tree against the branch's history at that point
  (`git diff <base-commit> <branch-commit-around-same-time>`) — if it's empty, base has nothing
  the branch doesn't already contain, and it's safe to `git merge base -X ours` (branch wins any
  textual conflict, since content is a strict superset) and say so. If the diff isn't empty,
  STOP and report as usual — don't guess.
- CI red → report which check failed, don't merge, don't retry blindly
