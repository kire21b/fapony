---
name: scrutinize
description: Outsider-perspective end-to-end review of a plan, PR, or code change, wired to fapony — pulls known failure patterns from run history before reviewing, records the verdict after. Trigger on /scrutinize and proactively whenever the user asks to review, audit, sanity-check, or get a second opinion on a plan, PR, diff, design doc, or proposed code change.
---

# Scrutinize

Stand outside the change and ask whether it should exist at all, then verify it
actually does what it claims end-to-end. Steps 1 and 6 talk to the `fapony` MCP
server; steps 2–5 are the review itself and need nothing but the repo.

## Operating stance

- **Outsider.** Forget who wrote it and why they think it's right. Read the artifact cold.
- **End-to-end, not diff-local.** The diff is the entry point, not the scope.
- **Run it, don't just read it.** A code path you only read is a hypothesis. Reading
  cannot see a command that exits 0 without doing anything, a timeout budget that no
  real suite fits, or a server process still running last week's build.
- **Actionable, with rationale.** Every finding states what to change, why, and what
  evidence led you there. No filler, no restating the diff back.

## Workflow

Run these in order. Do not skip ahead.

### 1. Known patterns (fapony)

Call `project_health_context` with `worktree` set to this project's repo name /
worktree key (e.g. `basename $(git rev-parse --show-toplevel)`) — never a hardcoded
literal, this skill ships to other projects.

It returns recurring `reason_code`s, escalated plans, round-1-pass shapes, and recent
verdict notes. Skim it; don't quote it back. Use it to know what to look at harder —
if `missing_test` already shows up 3×, look harder at coverage this time.

If the tool errors or fapony isn't wired in this session, skip silently and review
anyway. This step is a hint, not a gate.

### 2. Intent — what is this actually trying to do?

State the goal in one sentence, in your own words. If you cannot, the artifact is
underspecified — say so and stop.

Then ask whether a smaller path reaches the same goal: doing nothing (is the problem
load-bearing?), using something the codebase already has, a change that solves 90% of
it with 10% of the risk, or solving it at another layer (config vs code, build vs
runtime). If a better alternative exists, name it before the line-by-line review —
it is the most valuable thing you can output.

### 3. Trace — walk the actual code path

For each behavior the change claims, follow it end-to-end through the real code, not
just the lines in the diff: entry point → call sites → branches taken → state mutated
→ exit or side effect. Include the unchanged code on both sides of the diff; bugs hide
at the seams. For a plan or design doc, trace the proposed flow against the existing
system — where does it touch reality, and what does it assume that isn't true?

Note every place the trace surprises you. Surprises are signal.

### 4. Verify — does it actually do what it claims?

For each claim: **does the path you just traced produce that behavior?** Walk it
explicitly — "claims X; path A → B → C; at C, [observation]; therefore [holds / doesn't]".

Then: what inputs or states break it (edge cases, error paths, partial failures,
ordering, empty/huge inputs)? What does it silently change (performance, error
semantics, on-disk format, contract for other callers)? Do the tests exercise the
traced path, or pass while skipping it?

**Where you can run it, run it.** Execute the command, call the tool, check the
process — a green result you produced beats a green result you inferred.

### 5. Report

One tight section per finding, ordered blocker → major → nit:

- **Finding** — one sentence, specific, citing `file:line`.
- **Why it matters** — the consequence, not the principle.
- **Evidence** — the trace step, command output, or input that exposes it.
- **Suggested change** — concrete, minimal.

Close with a one-line verdict: ship / fix-then-ship / rework / reject, and the single
biggest reason.

### 6. Record the verdict (fapony)

Call `verdict_submit` once, after the report is shown. Don't block the report on it,
and don't let it change the report's content.

| Report verdict | `verdict` |
|---|---|
| ship, 0 findings | `pass-excellent` |
| ship, nit-only findings | `pass-good` |
| fix-then-ship | `pass-adequate` |
| rework / reject | `fail` |

`reason_code` — the *lead* (most severe) finding, not a generic bucket:

- missing or weak test coverage on the traced path → `missing_test`
- change is narrower or wider than the plan / PR description claims → `scope_mismatch`
- a shell/eval/deploy command runs without the guard it needs → `unsafe_command`
- the plan or spec didn't cover a case the trace exposed → `spec_gap`
- anything else, or 0 findings → `other`

Always attach a one-line `note`: it is the field that carries meaning into future
reviews (grades and codes only count; the note is what a later agent can act on).
Say what specifically broke or was traced, not that a review happened.

Args: `verdict`, `reason_code`, `note`, `worktree` (same key as step 1), and `plan`
(the PLAN file path under review, omitted for a bare PR/diff). No `run_id` — a run row
is created automatically for external callers.

If `verdict_submit` errors, say so in one line and move on. Never re-run the review
because storage failed.

## Operating rules

- **No rubber-stamps.** "LGTM" is not an output. If you genuinely find nothing, say
  what you traced and what you ran, so the user can judge the coverage.
- **Cite or it didn't happen.** Every claim references a path, file, line, or command
  output.
- **Distinguish claim from verification.** "The PR says X" and "I traced X and
  confirmed it" are different sentences — keep them apart.
- **One simpler-alternative pass is mandatory**, even on small changes. Skip only if
  the user says "don't question scope".
- **Lead with structure.** If step 2 or 3 surfaces a real problem, don't pad with
  style nits — defer or drop them.

## Example

```
1. project_health_context(worktree="fapony") → "missing_test (4×), spec_gap (2×)"
2-5. review — traced the new gate branch, ran the evidence command, found it exits 0
     without running the suite
6. verdict_submit(verdict="pass-adequate", reason_code="other",
     note="evidence entry `bun test` exits 0 while running zero tests — real entry is `bun run test`",
     worktree="fapony", plan=".fapony/plan/PLAN-verdict-notes.md")
```
