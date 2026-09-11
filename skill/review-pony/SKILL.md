---
name: review-pony
description: Review a plan, PR, diff, or design doc as a verification rather than an opinion — scope first, walk the real path, break it on paper, cite everything. Wired to fapony; pulls known failure patterns from run history before reviewing and records the verdict after. Trigger on /review-pony and proactively whenever the user asks to review, audit, scrutinize, sanity-check, or get a second opinion on a plan, PR, diff, design doc, or proposed code change.
---

# Review Pony

**A review is a verification, not an opinion.** Anything you cannot trace, run, or cite is
something you feel about the code — and feelings are what make reviews long and useless.

Four passes. Run them in order. Each one is allowed to end the review early.

## Open with this

Post these four lines before anything else, unchanged, so the user can hold you to them:

> 1. **Scope is a finding.** Does this need to exist, and does it need to be this big?
> 2. **Claims are not facts.** Walk the real path. Run what can be run.
> 3. **A finding needs a failing input.** Cannot write one? Not a finding.
> 4. **Facts carry a citation.** `file:line`, output, or trace step — or it doesn't ship.

Then start at pass 1.

---

## Before: what already goes wrong here (fapony)

Call `project_health_context` with `worktree` set to the **absolute path** of this repo —
`git rev-parse --show-toplevel`, never a hardcoded literal, this skill ships to other projects.
It returns recurring `reason_code`s, escalated plans, round-1-pass shapes, and recent verdict
notes.

The absolute path is not a preference. `runs.worktree` is free text, so a bare repo name writes
to a bucket no later query reads — `project_health_context` reports "not enough history" on a
project that has plenty, and `verification_report` on that run fails outright with *worktree key
"<name>" not found in config*. Every fapony tool scopes by absolute path. Match them.

Skim it, don't quote it back. It tells you where to press harder: if `missing_test` has come up
4×, coverage is not a nit in this repo. If the tool errors or fapony isn't wired in this session,
skip silently and review anyway — a hint, not a gate.

## Pass 1 — Scope is a finding

Say what the change is for in one sentence, in your own words. If you can't, the artifact is
underspecified. That is the review. Report it and stop.

Then take one pass down the ladder, and stop at the first rung that reaches the same goal:

1. **Nothing.** Is the problem load-bearing, or is this a fix for a hypothetical?
2. **What's already here.** A function, a flag, a stdlib call the author didn't know about.
3. **A native mechanism.** A DB constraint over app logic, config over code, build over runtime.
4. **90% for 10%.** The narrow change that solves the real case and drops the exotic ones.

If a rung holds, name it **before** any line-by-line notes. A scope finding is worth more than
every other finding combined, and it is worth nothing once the author has already rewritten the
code to answer your nits.

Mandatory even on small changes. Skip only if the user says "don't question scope".

## Pass 2 — Claims are not facts

The diff is where you enter, not what you review.

- **Walk the path end-to-end**: entry point → call sites → branches taken → state mutated → exit
  or side effect. Read the *unchanged* code on both sides. A diff is correct in isolation far
  more often than it is correct in place.
- **Read who calls this.** A signature change is fine until the third caller passes the old shape.
- **Run what can be run.** Reading cannot see a command that exits 0 without doing anything, a
  timeout budget no real suite fits, or a server still serving last week's build. A green result
  you produced outranks a green result you inferred, every time.
- **For a plan or design doc**, walk the proposed flow against the system that exists — where
  does it touch reality, and what does it assume that isn't true today?

Write down every place the walk surprises you. Surprises outrank style; chase them first.

## Pass 3 — A finding needs a failing input

Before a finding reaches the report, try to kill it yourself.

- **Write the failure scenario**: concrete inputs or state → the wrong output, crash, or
  corruption. Can't write that sentence? You have a preference. Drop it.
- **Look again for the guard you missed.** This is where most findings deserve to die: the
  validation lives in the caller, the branch is unreachable, the type already excludes it.
- **Label what survives.** `CONFIRMED` — you traced or ran it. `PLAUSIBLE` — the mechanism is
  real but you could not reach the failing state. Never let the second wear the first's clothes.
- **Don't flag by pattern.** "Should use dependency injection" is taste. "Calls `fetch` in a loop
  whose length comes from user input" is a finding.

## Pass 4 — Facts carry a citation

Every claim points at a `file:line`, a command's output, or the step in the walk that exposed it.
No citation, no report line.

Keep the claim and the verification in separate sentences. "The PR says it retries twice" and
"I traced it to `client.ts:88` and the retry is unreachable" are different statements; merging
them is how a review launders an assumption into a fact.

---

## Report

Most severe first: **blocker → major → nit.** If pass 1 or 2 turned up something structural, lead
with it and cut the nits entirely — they dilute the only thing worth reading.

One block per finding:

- **Finding** — one sentence, specific, citing `file:line`, marked `CONFIRMED` or `PLAUSIBLE`.
- **Failing input** — the inputs or state → the wrong result.
- **Evidence** — the trace step, command output, or input that exposed it.
- **Fix** — concrete and minimal.

Close with one line: **ship / fix-then-ship / rework / reject**, and the single biggest reason.

## After: record the verdict (fapony)

Call `verdict_submit` once, after the report is shown. Don't block the report on it, and don't
let it change the report's content.

| Report verdict | `verdict` |
|---|---|
| ship, 0 findings | `pass-excellent` |
| ship, nit-only findings | `pass-good` |
| fix-then-ship | `pass-adequate` |
| rework / reject | `fail` |

`reason_code` — the *lead* (most severe) finding, not a generic bucket:

- missing or weak test coverage on the path you walked → `missing_test`
- change is narrower or wider than the plan / PR description claims → `scope_mismatch`
- a shell/eval/deploy command runs without the guard it needs → `unsafe_command`
- the plan or spec didn't cover a case the walk exposed → `spec_gap`
- anything else, or 0 findings → `other`

Always attach a one-line `note`. Grades and codes only count; the note is the only field a later
review can act on. Say what specifically broke or was walked, not that a review happened.

Args: `verdict`, `reason_code`, `note`, `worktree` (same key as the pre-step), and `plan` (the
PLAN file path under review, omitted for a bare PR/diff). No `run_id` — fapony reuses the
latest still-open run for the same worktree+plan (so round 2+ counts toward the round cap),
creating a row only when none is open.

`session_id` (optional) — the client session id so fapony can attribute the model from the session
log when no spawn events exist. OpenCode/ZCode: the session id string. Claude Code/Codex: the
`.jsonl` file path. Only send it if the client exposes it; if not, omit — never block the submit
on it.

If `verdict_submit` errors, say so in one line and move on. Never re-run a review because storage
failed.

---

## Rules

- **Post the four lines once**, at the top, unchanged. Not again mid-review. If the user says to
  skip them, skip the posting and run the four passes anyway.
- **Order is not optional.** No line-by-line notes before pass 1 has asked whether the change
  should exist. No finding before pass 2 has walked its path. No finding before pass 3 has tried
  to disprove it. Nothing stated as fact that pass 4 cannot cite.
- **No rubber-stamps.** "LGTM" is not an output. Finding nothing is a valid result — then say what
  you walked and what you ran, so the user can judge the coverage instead of trusting it.
- **Forget who wrote it.** The author's reasoning is context, never evidence.
- **Never restate the diff.** If a line tells the author something they already know, cut it.
- The four passes are a constraint you carry, not advice you hand back.

## Example

```
pre.  project_health_context(worktree="/Users/you/Project/fapony/wt-fapony")
        → "missing_test (4×), spec_gap (2×)"
1-4.  scope holds; walked the new gate branch; ran the evidence command — it exits 0
      without running the suite (CONFIRMED: `bun test` with no test dir exits 0)
post. verdict_submit(verdict="pass-adequate", reason_code="other",
        note="evidence entry `bun test` exits 0 while running zero tests — real entry is `bun run test`",
        worktree="/Users/you/Project/fapony/wt-fapony",
        plan=".fapony/plan/PLAN-verdict-notes.md")
```
