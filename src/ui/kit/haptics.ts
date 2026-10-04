// Haptics for a web game. iOS has no navigator.vibrate, but Safari (17.4+) plays a system haptic
// when the user's own tap toggles an <input type="checkbox" switch>. Since iOS 26.5 a scripted
// click no longer counts, so kit buttons that want a haptic render as a <label> wrapping a hidden
// switch: the finger lands on the label, the label toggles the switch, the Taptic Engine ticks.
// iPads have no Taptic Engine; Android gets a short navigator.vibrate instead.

export const IOS =
  typeof navigator !== 'undefined' && (/iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Non-iOS fallback; on iOS the switch inside the pressed label does the work. */
export function vibrate() {
  if (!IOS) navigator.vibrate?.(8);
}

/** Props for the hidden switch (`switch` is not in React's input typings yet). */
export const switchProps = { type: 'checkbox', switch: '' } as unknown as React.InputHTMLAttributes<HTMLInputElement>;
