export function templateArgs(
  arr: string[],
  vars: Record<string, string>
): string[] {
  return arr.map((s) => {
    let out = s;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(`{${k}}`, v);
    }
    return out;
  });
}
