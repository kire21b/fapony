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

# post-merge — ALWAYS, for a long-lived branch (dev, develop) that was squash-merged:
git fetch origin
git reset --hard origin/<default-branch>
git push --force-with-lease origin <branch>
```

The post-merge reset is not optional. Squashing rewrites the commits, so the branch keeps
originals the base will never have — the two diverge a little more every ship, and GitHub answers
every later PR with *"Can't automatically merge"* even when the content is identical. Resetting
the branch onto the freshly merged base makes them the same commit again, so the next PR is clean.
Skip it only for a throwaway feature branch you're about to delete. It force-pushes, so say so —
and check `git status --porcelain` is clean first (uncommitted work would be destroyed).

## Rules

- **Never push to `main`/`master` directly** — always via PR
- **Never merge with failing CI** — check `gh pr checks` first; if red or pending, report and wait
- **Never `--admin` merge** (bypassing branch protection) unless the user explicitly says to
- **Never force-push** an existing PR branch without saying so first
- One PR per concern, same as commits — don't bundle unrelated branches into one PR

## If fail

- `gh` not authenticated → tell the user to run `gh auth login`
- `gh pr create` warns *"Can't automatically merge"* → that's the base's problem, not `gh`'s.
  The PR still gets created. Don't stop there — go verify it as the next bullet says.
- Merge conflict with base branch → STOP, report, don't resolve unilaterally. Exception: a
  long-lived branch that skipped the post-merge reset above — then the "conflict" is squash
  history mismatch, not divergent content. Verify: `git diff origin/<base> HEAD --stat` versus
  the diff of the branch's own unmerged commits (`git diff <first-unmerged>~1 HEAD --stat`).
  Identical means base holds nothing the branch lacks, so `git merge origin/<base> -X ours` is
  safe (branch wins every textual conflict, content is a strict superset) — say so, merge, then
  do the post-merge reset so it stops recurring. Not identical → STOP and report, don't guess.
- CI red → report which check failed, don't merge, don't retry blindly
