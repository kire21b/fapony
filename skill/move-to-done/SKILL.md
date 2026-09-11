---
name: move-to-done
description: Move PLAN to .fapony/plan/done/ after ship + archive related spec. Trigger on /move-to-done and when the user asks to archive a completed plan.
---

# Move to Done — archive PLAN after ship

You are about to move a PLAN that has been shipped to the archive.

## Rules

1. **PLAN must have shipped header** — regex: `^> ✅ \*\*.*shipped.*\*\*$`
   If missing, add it yourself, don't ask — invoking this skill *is* the ship claim (the user
   has already verified the work landed; this step is paperwork). Replace the plan's
   status/header line with `> ✅ **shipped** (<hash>)`, `<hash>` = `git rev-parse --short HEAD`.
   Say in the summary that you stamped it, so a wrong HEAD is visible and correctable.
   STOP only if there's no git repo / no commits to hash from.

2. **Rewrite relative links first** — `.fapony/plan/done/` is 1 level deeper than `.fapony/plan/`
   - Normalize first (remove stacked `../`)
   - Then prepend `../` to every link

3. **Check inbound links** from other files (use grep):
   ```bash
   grep -rln 'PLAN-foo.md' .fapony/plan/ .fapony/spec/ docs/
   ```
   If fewer than 5 → fix yourself · If more → report

4. **Use `git mv` not rm + add** — preserves history:
   ```bash
   git mv .fapony/plan/PLAN-foo.md .fapony/plan/done/PLAN-foo.md
   ```
   If git refuses ("not under version control" — `.fapony/` is gitignored in this repo), plain
   `mv` instead; there's nothing to commit for an untracked path, so skip step 6 in that case.

5. **Archive the related spec too** — if the PLAN's "Source spec:" line points to a file under
   `.fapony/spec/`, move it to `.fapony/spec/done/` the same way (same git-mv-or-plain-mv rule,
   normalize its links first — remember the spec's "Used by" backlink to the plan must also
   gain the plan's own `done/` segment, since both moved). No source spec → skip, don't invent one.

6. **Commit split by concern** (only when the moved files are actually tracked by git):
   ```
   chore(plan): archive PLAN-foo.md (shipped <hash>)
   ```

7. **Record the verdict** — call the `verdict_submit` MCP tool (fapony) so this ship feeds
   `project_health_context` for whoever touches these files next. No `run_id` needed:
   - `verdict`: `pass` (adjust if the ship had known rough edges — see VERDICT_GRADES)
   - `reason_code`: `missing_test` / `scope_mismatch` / `unsafe_command` / `spec_gap` / `other`
     — `other` when the ship was clean and nothing fits
   - `note`: **omit it on a clean ship.** A verdict with no note still counts toward the plan
     history future drafts read ("passed round 1 before"), but only notes reach the three
     free-text slots `project_health_context` shows — so "clean ship" evicts a note that would
     have taught the next session something. Write one only when this plan hit something a
     reader could not get from the diff: what the symptom looked like, where the cause actually
     was, and the rule that follows. Standalone prose — it is read months later with no access
     to this conversation.
   - `worktree`: **absolute path** to this repo/worktree (`git rev-parse --show-toplevel`) —
     every other fapony tool (`fapony_usage`, `fapony_stats`, `project_health_context`)
     scopes by absolute path too; a bare repo name won't match those queries
   - `plan`: the archived plan's path (post-move, e.g. `.fapony/plan/done/PLAN-foo.md`)
   - `files`: repo-relative paths this plan touched (`git diff --name-only <base>..HEAD`) —
     the only input to per-file risk history; without it the verdict says something happened
     but not where
   Skip only if fapony's MCP tools aren't available in this session — don't block the archive on it.

## Example

```
Input: .fapony/plan/PLAN-kickoff.md with header "> ✅ **shipped** (a1b2c3)"
Steps:
1. normalize links: [templates/](../templates/) → [../templates/](../templates/)
2. inbound: README.md, .fapony/plan/PLAN-loop.md
3. git mv
4. commit
5. verdict_submit(verdict="pass", reason_code="other", worktree="/Users/you/Project/fapony/wt-fapony", plan=".fapony/plan/done/PLAN-kickoff.md", files=["src/kickoff.ts"])
   — clean ship, so no note
```

A ship worth a note looks like this instead:

```
5. verdict_submit(verdict="pass-adequate", reason_code="spec_gap",
     note="sheet scroll reset on open, not close — the restore hook was on the wrong side; the router's own scrollRestoration resets on every navigate(). Check the router option before writing a restore hook.",
     worktree="/Users/you/Project/vela", plan=".fapony/plan/done/PLAN-quick-nav.md",
     files=["src/routes/expenses/index.tsx"])
```

## If fail

- No git repo / no commits (can't derive a shipped hash) → tell user: "Add header > ✅ **shipped** (<hash>) first"
- Stamped the header yourself → always say which hash you used
- Link normalize fails → report which paths normalized wrong
- Too many inbound links → report full list, don't fix yourself
