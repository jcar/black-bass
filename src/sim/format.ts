/** "3-04" (pounds-ounces), the way tournament weights are read out. Shared by sim text and UI. */
export function lbOzText(lb: number): string {
  const whole = Math.floor(lb);
  const oz = Math.round((lb - whole) * 16);
  return oz === 16 ? `${whole + 1}-00` : `${whole}-${String(oz).padStart(2, '0')}`;
}
