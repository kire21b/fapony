---
name: review-mantra
description: Four-mantra review discipline — find the goal, trace the real path not the diff, falsify your own finding, cite everything. Recite the mantra block verbatim at the start of any review, then apply the four steps in order before reporting. Wired to fapony — pulls known failure patterns from run history before reviewing, records the verdict after. Trigger on /review-mantra and proactively whenever the user asks to review, audit, scrutinize, sanity-check, or get a second opinion on a plan, PR, diff, design doc, or proposed code change.
---

# Review Mantra

Four-step discipline for reviewing a plan, PR, diff, or design doc. Recite verbatim, then apply in order.

## Recite this — verbatim, as the first thing in your first response

> **Mantra:**
> 1. **First is the goal.** What is this for — and what smaller thing reaches it?
> 2. **Trace the path, not the diff.** The diff is the entry point; bugs live at the seams.
> 3. **Falsify your own finding.** No concrete failing input, no finding.
> 4. **Cite or it didn't happen.** Every claim carries a line, an output, or a trace step.

Then begin work.

---

## Before you start — known patterns (fapony)

Call `project_health_context` with `worktree` set to this project's repo name or worktree key
(`basename $(git rev-parse --show-toplevel)` — never a hardcoded literal, this skill ships to
other projects). It returns recurring `reason_code`s, escalated plans, round-1-pass shapes, and
recent verdict notes.

Skim it; don't quote it back. It tells you where to look harder — if `missing_test` already shows
up 3×, weigh coverage more this time. If the tool errors or fapony isn't wired in this session,
skip silently and review anyway. This is a hint, not a gate.

## 1. First is the goal

State what the change is for in one sentence, in your own words. If you can't, the artifact is
underspecified — say so and stop; that *is* the finding.

Then spend one pass on whether something smaller reaches the same goal:

- **Nothing** — is the problem load-bearing, or is this a fix for a hypothetical?
- **Something already here** — a function, a flag, a stdlib call the author didn't know about.
- **90% for 10%** — a narrower change that solves the real case and skips the exotic ones.
- **Another layer** — config instead of code, a DB constraint instead of app logic, build time
  instead of runtime.

If a better path exists, name it **before** the line-by-line review. It is the most valuable
thing this skill can output, and it is worthless after the author has already responded to nits.

This pass is mandatory, even on small changes. Skip it only if the user says "don't question scope".

## 2. Trace the path, not the diff

For each behavior the change claims, follow it end-to-end through the real code: entry point →
call sites → branches taken → state mutated → exit or side effect. Read the **unchanged** code on
both sides of the diff — a diff is correct in isolation far more often than it is correct in place.

- **Read who calls this**, not just what it does. A signature change is fine until the third
  caller passes the old shape.
- **Run it where you can.** A path you only read is a hypothesis. Reading cannot see a command
  that exits 0 without doing anything, a timeout no real suite fits, or a server still serving
  last week's build. A green result you produced beats one you inferred.
- **For a plan or design doc**, trace the proposed flow against the system that exists — where
  does it touch reality, and what does it assume that isn't true today?

Note every place the trace surprises you. Surprises are signal; chase them before style.

## 3. Falsify your own finding

Before a finding goes in the report, try to kill it.

- **Write the failure scenario**: concrete inputs or state → the wrong output, crash, or
  corruption that results. If you cannot write that sentence, you have a feeling, not a finding —
  drop it.
- **Re-read the surrounding code for the guard you missed.** Most review findings die here: the
  validation is in the caller, the case is unreachable, the type already excludes it.
- **Label what survives**: `CONFIRMED` (you traced or ran it) versus `PLAUSIBLE` (the mechanism is
  real but you could not reach the failing state). Never present the second as the first.
- **Don't flag by pattern.** "This should use dependency injection" is a preference. "This calls
  `fetch` in a loop of unbounded length from user input" is a finding.

## 4. Cite or it didn't happen

Every claim references a `file:line`, a command's output, or the step in your trace that exposed
it. No citation means it doesn't go in the report.

Keep **claim** and **verification** in different sentences: "the PR says X" and "I traced X to
`store.ts:88` and confirmed it" are not the same statement, and collapsing them is how a review
launders an assumption into a fact.

---

## Report

Most severe first: **blocker → major → nit.** If step 1 or 2 surfaced a structural problem, lead
with it and drop the nits entirely — they dilute the thing that matters.

One tight block per finding:

- **Finding** — one sentence, specific, citing `file:line`. Mark `CONFIRMED` or `PLAUSIBLE`.
- **Failure scenario** — the inputs or state → the wrong result.
- **Evidence** — the trace step, command output, or input that exposed it.
- **Fix** — concrete and minimal.

Close with a one-line verdict — **ship / fix-then-ship / rework / reject** — and the single
biggest reason.

## After the report — record the verdict (fapony)

Call `verdict_submit` once, after the report is shown. Don't block the report on it, and don't
let it change the report's content.

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

Always attach a one-line `note` — grades and codes only count, the note is the only field a later
review can act on. Say what specifically broke or was traced, not that a review happened.

Args: `verdict`, `reason_code`, `note`, `worktree` (same key as the pre-step), and `plan` (the
PLAN file path under review, omitted for a bare PR/diff). No `run_id` — a run row is created
automatically for external callers.

If `verdict_submit` errors, say so in one line and move on. Never re-run the review because
storage failed.

---

## Operating rules

- Recite the mantra block **once** per review, in your first response. Do not re-recite mid-review.
- Recite **verbatim**. Never paraphrase, shorten, or skip lines of the recital.
- If the user says "skip the mantra" → skip the recital but still apply the four steps silently.
- Apply the four steps **in order**:
  - Do not review line-by-line before #1 has asked whether the change should exist.
  - Do not report a finding before #2 has traced the path it lives on.
  - Do not report a finding before #3 has tried to disprove it.
  - Do not state anything as fact that #4 cannot cite.
- **No rubber-stamps.** "LGTM" is not an output. Finding nothing is a valid result — then say what
  you traced and what you ran, so the user can judge the coverage.
- **Forget who wrote it.** Read the artifact cold; the author's reasoning is not evidence.
- **Never restate the diff back.** If a line adds nothing the author doesn't already know, cut it.
- The mantra is a constraint **you** carry through the review — not advice to deliver back.

## Example

```
pre.  project_health_context(worktree="fapony") → "missing_test (4×), spec_gap (2×)"
1-4.  traced the new gate branch; ran the evidence command; it exits 0 without
      running the suite (CONFIRMED — `bun test` with no test dir exits 0)
post. verdict_submit(verdict="pass-adequate", reason_code="other",
        note="evidence entry `bun test` exits 0 while running zero tests — real entry is `bun run test`",
        worktree="fapony", plan=".fapony/plan/PLAN-verdict-notes.md")
```
