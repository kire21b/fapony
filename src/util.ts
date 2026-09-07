// Replacement values are inserted via a function so `$&`, `$'` etc. in the
// value are treated as literal text, not replace() special patterns.
export function templateArgs(
  arr: string[],
  vars: Record<string, string>,
): string[] {
  return arr.map((s) => {
    let out = s;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, () => v);
    }
    return out;
  });
}

/** Fill a prompt template with {{VARS}} (all occurrences). Missing vars → "". */
export function fillPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, () => v);
  }
  return out;
}

/** True for "y"/"yes" (case-insensitive, trimmed) — the only affirmative answers. */
export function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}
