You are working in a worktree managed by fapony.

## Plan

{{PLAN}}

## Memory ID

{{MEM_ID}}

## Rules

- Commit changes as you go, split by concern/domain — one commit per feature/area touched. Do NOT bundle unrelated changes into one commit.
- Do NOT `git push` — pushing waits for the user or the review gate.
- Do NOT run `git reset --hard`, `git clean -fd`, `git checkout -- .`, or `git stash` — these are banned.
- If `git status --porcelain` shows unexpected uncommitted files, STOP and report — do not clean them.
- Do NOT write any files outside the worktree (fapony state lives at ~/.fapony/).

## Required Output

When you finish, output this block as the very last thing:

## HANDOFF
claimed: <memory id or none>
commits: <hashes separated by spaces>
checks: <check names and results>
uncertain: <0-3 points you are unsure about, or none>
not_done: <items from the plan you did not complete, or none>
