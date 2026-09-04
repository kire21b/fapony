// src/safety.ts — deny-list for dangerous git commands.
// Rule: assertSafe() must be called on every command before spawn, including
// ones built from config templates (mem claim/close, review gate, executor).

const DANGEROUS_PATTERNS = [
  /reset\s+--hard/,
  /clean\s+-[a-z]*f/,
  /checkout\s+--\s/,
  /git\s+stash/,
];

export function assertSafe(argv: string[]): void {
  const joined = argv.join(" ");
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(joined)) {
      throw new Error(`refusing to run dangerous command: ${joined}`);
    }
  }
}
