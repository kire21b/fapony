---
name: scrutinize
description: Outsider-perspective end-to-end review of a plan, PR, or code change — fapony-wired variant. Pulls known-failure patterns from fapony history before reviewing, and records the verdict back into fapony after. Trigger on /scrutinize and proactively whenever the user asks to review, audit, sanity-check, or get a second opinion on a plan, PR, diff, design doc, or proposed code change in this repo.
---

# Scrutinize (fapony-wired)

This is the global `scrutinize` skill (outsider stance, 4-step workflow: Intent →
Trace → Verify → Report) with two extra steps that only make sense inside this
repo, where the `fapony` MCP server is available. Load the global skill for the
review method itself — this file only adds step 0 (before) and step 5 (after).

## Step 0 — known patterns first (before Intent)

Call `project_health_context` (fapony MCP) with `worktree` set to this
project's **absolute** repo path (`git rev-parse --show-toplevel`) — every
fapony tool scopes `worktree` by absolute path (see `fapony_usage`,
`fapony_stats`), not a bare repo name; this file also ships to other
projects via `fapony init`, so never hardcode a literal path here). It
returns a short "known patterns" block — recurring
`reason_code`s, escalated plans, round-1-pass shapes from past verdicts. Skim
it, don't quote it back — use it to know what to look for harder (e.g. if
`missing_test` shows up 3× already, look harder at test coverage this time).

If the tool errors or fapony isn't wired in this session, skip silently and
proceed with the review — this step is a hint, not a gate.

## Steps 1–4 — run the global `scrutinize` workflow unchanged

Intent → Trace → Verify → Report, exactly as the global skill defines them.
Do not duplicate that content here; load it.

## Step 5 — record the verdict (after Report)

Call `verdict_submit` (fapony MCP) once, after the report is shown to the user
— don't block showing the report on this call, and don't let it change the
report's content.

Map the review's closing one-line verdict → fapony's grades:

| scrutinize verdict | verdict_submit `verdict` |
|---|---|
| ship, 0 findings | `pass-excellent` |
| ship, nit-only findings | `pass-good` |
| fix-then-ship | `pass-adequate` |
| rework | `fail` |
| reject | `fail` |

`reason_code` — pick the one the *lead* (most severe) finding actually is,
not a generic bucket:

- missing/weak test coverage on the traced path → `missing_test`
- change does something narrower/wider than the plan or PR description claims → `scope_mismatch`
- a shell/eval/deploy command runs without the guard it needs → `unsafe_command`
- the plan/spec didn't cover a case the trace exposed → `spec_gap`
- anything else, or 0 findings → `other` (always attach a one-line `note`
  summarizing the finding or, on 0 findings, what was traced)

Args:
- `verdict`, `reason_code`, `note` — as above (note ≤ 1 sentence, it feeds
  future `project_health_context` calls verbatim)
- `worktree`: same absolute path used in step 0 — never a hardcoded literal
- `plan`: the PLAN file path under review, if any (e.g. `.fapony/plan/PLAN-foo.md`) — omit for a bare PR/diff review with no plan file

No `run_id` — `verdict_submit` auto-creates a run row for external callers.

If `verdict_submit` errors or isn't available, say so in one line and move on
— never re-run the review because storage failed.

## Example

```
0. project_health_context(worktree="/Users/you/Project/fapony/wt-fapony") → "missing_test (4×), spec_gap (2×)"
   (worktree here is fapony's own absolute repo path — a project that ships
   this skill via `fapony init` would use its own absolute path instead)
1-4. run global scrutinize workflow — finds one MAJOR: new gate branch has no test
5. verdict_submit(verdict="pass-adequate", reason_code="missing_test",
   note="gate branch for round-cap escalation has no test, fixed inline",
   worktree="/Users/you/Project/fapony/wt-fapony", plan=".fapony/plan/PLAN-verdict-notes.md")
```
