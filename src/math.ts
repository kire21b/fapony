// src/math.ts — pure numeric helpers shared across modules

/** Minutes between two ISO-like timestamps (space separator, UTC assumed). */
export function minutesBetween(a: string, b: string): number {
  const t0 = new Date(`${a.replace(" ", "T")}Z`).getTime();
  const t1 = new Date(`${b.replace(" ", "T")}Z`).getTime();
  return (t1 - t0) / 60000;
}

/** Arithmetic mean of a numeric array. 0 for empty arrays. */
export function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
