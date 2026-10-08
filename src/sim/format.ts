/** "3-04" (pounds-ounces), the way tournament weights are read out. Shared by sim text and UI. */
export function lbOzText(lb: number): string {
  const whole = Math.floor(lb);
  const oz = Math.round((lb - whole) * 16);
  return oz === 16 ? `${whole + 1}-00` : `${whole}-${String(oz).padStart(2, '0')}`;
}

/** A fish's weight as the scale reads it: to the nearest ounce. Bags are sums of these, so they add up. */
export const scaleLb = (lb: number) => Math.round(lb * 16) / 16;

/** Game minutes as "7 h 52 m" (or "25 m" under an hour). */
export function hoursMinText(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} m` : `${m} m`;
}

/** "1 bite", "3 bites". */
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
