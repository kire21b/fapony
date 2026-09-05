# Spec Core — template for every spec file

> Use with [PLAN.md](PLAN.md). A spec holds the **detail** a plan should only
> link to: API/data shapes, schemas, wireframes, edge cases, examples. Put it
> in `.fapony/spec/<feature>.md`.

```markdown
# SPEC-<feature>.md — <short name>

> **Used by:** [PLAN-<feature>.md](../plan/PLAN-<feature>.md)
> (add every plan that references this spec — keeps the link bidirectional so
> either file leads you to the other, and `fapony plan-mv` finds this file
> when it scans inbound links.)

---

## Shape (data / API / schema)
Concrete types, request/response bodies, DB columns — whatever the code needs.

## Edge cases
Table or bullets: input → expected behavior.

## Examples
Before / after, request / response, sample payloads — as long as it needs to be.
```

**Rule:** a plan's section 7 (Examples) links here instead of pasting content.
If a plan keeps growing, the fix is usually "move it into the spec", not
"trim the plan" — the detail is still needed, just not in the file an agent
re-reads every round.
