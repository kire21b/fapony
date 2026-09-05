# Plan Core — template for every plan file

> Use this template for every plan file (not just fapony) — see [CLAUDE.md](../CLAUDE.md) § Rules
> for AI Agents for the rules each plan must pass before an agent may execute it.

```markdown
# PLAN-<feature>.md — <short name>

> **Status:** 🚧 in-progress · **Owner:** <dev> · **Created:** <YYYY-MM-DD>
> **Source spec:** [spec/<feature>.md](../spec/<feature>.md) — if any

---

## 1. Goal (why)
1–3 sentences — if a reader can't answer "so what" after reading = not clear yet

## 2. Scope (do / don't do)
**Do:** 3–7 bullets, outcomes not tasks
**Don't do:** 2–5 bullets + 1-line reason per item

## 3. Done criteria (how we know it's finished)
3–6 bullets — testable (tests pass / command runs / user can reproduce)
Never write bare "done" — must be measurable

## 4. Constraints / Hard rules (must not violate)
3–8 bullets — violations that break things (not "good practices")

## 5. Risks & Escape hatches (if it fails)
Table with 3–5 rows: risk | likelihood | impact | escape hatch

## 6. Steps (what in which order)
1. **<Step 1>** — has a clear deliverable
2. **<Step 2>** — ...
Each step must be verifiable before moving to the next

## 7. Examples (make it concrete)
bash examples: before / after

## 8. References
- link back to related files
```

**3 iron rules:**
- Sections 1–4 are mandatory — if missing = plan is immature, agent must not execute
- Section 6 each step must be verifiable — if you can't tell it passed = not clear yet
- Section 8 must link back — prevents drift and gives context on reopen
