---
name: move-to-done
description: Move PLAN to .fapony/plan/done/ after ship + archive related spec. Trigger on /move-to-done and when the user asks to archive a completed plan.
---

# Move to Done — archive PLAN after ship

You are about to move a PLAN that has been shipped to the archive.

## Rules

1. **PLAN must have shipped header** — regex: `^> ✅ \*\*.*shipped.*\*\*$`
   If missing → STOP, report what's needed

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

5. **Archive the related spec too** — if the PLAN's "Source spec:" line points to a file under
   `.fapony/spec/`, `git mv` it to `.fapony/spec/done/` the same way (normalize its links first).
   No source spec → skip, don't invent one.

6. **Commit split by concern**:
   ```
   chore(plan): archive PLAN-foo.md (shipped <hash>)
   ```

## Example

```
Input: .fapony/plan/PLAN-kickoff.md with header "> ✅ **shipped** (a1b2c3)"
Steps:
1. normalize links: [prompts/](../prompts/) → [../prompts/](../prompts/)
2. inbound: README.md, .fapony/plan/PLAN-loop.md
3. git mv
4. commit
```

## If fail

- File header doesn't match → tell user: "Add header > ✅ **shipped** (<hash>) first"
- Link normalize fails → report which paths normalized wrong
- Too many inbound links → report full list, don't fix yourself
