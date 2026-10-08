import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { LURES } from '../../data/lures';
import { TUNING } from '../../data/tuning';
import { inputHub, retrieveHint } from '../../game/input';
import { unlockAudio } from '../../audio/sound';
import type { GamePhase } from '../../sim/types';
import { useStore } from '../../state/store';
import { IOS, switchProps, vibrate } from '../kit/haptics';

const STICK_R = 60;

/**
 * Line tension as a ring around the REEL button, right under the thumb that controls it. Colour,
 * fill and a pulse near breaking strength, so it never relies on colour alone.
 */
function TensionRing({ tension }: { tension: number }) {
  const t = Math.min(1, tension);
  const R = 64;
  const C = 2 * Math.PI * R;
  const cls = t > TUNING.fight.tensionDanger ? 'danger' : t > TUNING.fight.tensionWarn ? 'warn' : '';
  return (
    <svg className={`tension-ring ${cls}`} viewBox="0 0 140 140" aria-hidden="true">
      <circle cx="70" cy="70" r={R} className="track" />
      <circle cx="70" cy="70" r={R} className="fill" strokeDasharray={`${C * t} ${C}`} transform="rotate(-90 70 70)" />
    </svg>
  );
}

/** Hold-to-act button (REEL, THUMB): pointer capture so sliding a thumb off doesn't stick it on. */
function HoldButton({ label, size, onChange, children }: { label: string; size: 'xl' | 'lg' | 'md'; onChange: (down: boolean) => void; children?: ReactNode }) {
  const [held, setHeld] = useState(false);
  const set = (v: boolean) => {
    setHeld(v);
    onChange(v);
  };
  // The button disappears on a phase change while a thumb is still down: never leave REEL stuck on.
  const release = useRef(onChange);
  useEffect(() => {
    release.current = onChange;
  });
  useEffect(() => () => release.current(false), []);
  return (
    <button
      className={`tbtn ${size} ${held ? 'held' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        unlockAudio();
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
    >
      {children}
      {label}
    </button>
  );
}

function TapButton({
  label,
  size,
  onTap,
  disabled,
  accent,
  haptic,
  cue,
}: {
  label: string;
  size: 'xl' | 'lg' | 'md';
  onTap: () => void;
  disabled?: boolean;
  accent?: boolean;
  haptic?: boolean;
  /** Glow and pulse: this is the moment to press it (FISH in casting range of a stop). */
  cue?: boolean;
}) {
  // On iPhone the haptic comes from the user's own tap toggling a switch inside a label; the action
  // itself still fires on pointerdown so there's no tap delay.
  if (haptic && IOS)
    return (
      <label
        role="button"
        aria-disabled={disabled}
        className={`tbtn ${size} ${accent ? 'accent' : ''} ${disabled ? 'disabled' : ''} ${cue ? 'cue' : ''}`}
        onPointerDown={() => {
          unlockAudio();
          if (!disabled) onTap();
        }}
      >
        <input {...switchProps} className="haptic-switch" tabIndex={-1} aria-hidden="true" disabled={disabled} />
        {label}
      </label>
    );
  return (
    <button
      className={`tbtn ${size} ${accent ? 'accent' : ''} ${cue ? 'cue' : ''}`}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        unlockAudio();
        if (!disabled) {
          if (haptic) vibrate();
          onTap();
        }
      }}
    >
      {label}
    </button>
  );
}

/**
 * Hybrid touch layout: a floating thumbstick on the left (steer, aim, work the rod) and
 * contextual buttons on the right. Gestures only where they feel natural: tap the left side
 * to twitch, flick down to bow to a jumping fish.
 */
interface ControlsProps {
  phase: GamePhase;
  canFish: boolean;
  /** In casting range of the destination, a PRO stop or a waypoint: FISH glows (fishing anywhere is still allowed). */
  inRange: boolean;
  castFlying: boolean;
  castCharging: boolean;
  /** Rounded to 2 decimals by the caller so the memo holds between meaningful changes. */
  tension: number;
  leftHanded: boolean;
  /** Lure on the active rod: the retrieve hint depends on how it's worked. */
  lureId: string;
  /** "Data for this point" at this tier: game minutes it costs (0 = free), null = not available. */
  dataMin: number | null;
}

/** Memoised: the HUD snapshot ticks at 10 Hz, but the controls only change with these props. */
export const TouchControls = memo(function TouchControls({ phase, canFish, inRange, castFlying, castCharging, tension, leftHanded, lureId, dataMin }: ControlsProps) {
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const touch = useRef<{ id: number; t0: number; x0: number; y0: number } | null>(null);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (touch.current) return;
    unlockAudio();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    touch.current = { id: e.pointerId, t0: performance.now(), x0: e.clientX, y0: e.clientY };
    setStick({ ox, oy, x: 0, y: 0 });
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!touch.current || touch.current.id !== e.pointerId) return;
    let dx = e.clientX - touch.current.x0;
    let dy = e.clientY - touch.current.y0;
    const m = Math.hypot(dx, dy);
    if (m > STICK_R) {
      dx = (dx / m) * STICK_R;
      dy = (dy / m) * STICK_R;
    }
    inputHub.stick = { x: dx / STICK_R, y: -dy / STICK_R };
    setStick((s) => (s ? { ...s, x: dx, y: dy } : s));
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = touch.current;
    if (!t || t.id !== e.pointerId) return;
    const dt = performance.now() - t.t0;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;
    const d = Math.hypot(dx, dy);
    if (dt < 260 && d > 28 && dy > Math.abs(dx)) inputHub.tap('bowFlick');
    else if (dt < 260 && (phase === 'Present' || phase === 'Fight')) inputHub.tap('twitch');
    touch.current = null;
    inputHub.stick = { x: 0, y: 0 };
    setStick(null);
  };

  // Desktop (no touch): show the key map instead of thumb hints.
  const keyboard = typeof window !== 'undefined' && !('ontouchstart' in window) && navigator.maxTouchPoints === 0;
  const hint = keyboard
    ? phase === 'Navigate'
      ? 'WASD steer (quiet) · Shift+WASD run · M map · F fish'
      : phase === 'Cast'
        ? 'A/D aim · C cast, C again to release · B thumb · M move'
        : phase === 'Present'
          ? retrieveHint(LURES[lureId], true)
          : phase === 'Fight'
            ? 'Space reel · B thumb · A/D pull opposite · V bow on jumps'
            : ''
    :
    phase === 'Navigate'
      ? 'Drag to drive · light push = quiet trolling motor'
      : phase === 'Cast'
        ? 'Drag left/right to aim'
        : phase === 'Present'
          ? retrieveHint(LURES[lureId], false)
          : phase === 'Fight'
            ? 'Pull opposite the fish · flick ↓ to bow on jumps'
            : '';

  return (
    <div className={`touch ${leftHanded ? 'lefty' : ''}`}>
      <div className="stick-zone" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {stick && (
          <>
            <div className="stick-base" style={{ left: stick.ox, top: stick.oy }} />
            <div className="stick-knob" style={{ left: stick.ox + stick.x, top: stick.oy + stick.y }} />
          </>
        )}
        {!stick && <div className="stick-hint">{hint}</div>}
      </div>
      <div className="btn-zone">
        {phase === 'Navigate' && <TapButton label="FISH" size="xl" accent haptic disabled={!canFish} cue={inRange && canFish} onTap={() => inputHub.tap('fishHere')} />}
        {phase === 'Cast' && (
          <>
            {!castFlying && (
              <div className="btn-row">
                {dataMin !== null && !castCharging && <TapButton label={dataMin ? `DATA ${dataMin}m` : 'DATA'} size="md" onTap={() => useStore.getState().checkPoint(true)} />}
                <TapButton label="MOVE" size="md" onTap={() => inputHub.tap('moveOn')} />
              </div>
            )}
            <div className="btn-row">
              {castFlying ? (
                <HoldButton label="THUMB" size="xl" onChange={(v) => (inputHub.brake = v)} />
              ) : (
                <TapButton label={castCharging ? 'RELEASE' : 'CAST'} size="xl" accent haptic onTap={() => inputHub.tap('castTap')} />
              )}
            </div>
          </>
        )}
        {phase === 'Present' && (
          <>
            <TapButton label="BURN IN" size="md" onTap={() => inputHub.tap('moveOn')} />
            <div className="btn-row">
              <TapButton label="TWITCH" size="lg" onTap={() => inputHub.tap('twitch')} />
              <HoldButton label="REEL" size="xl" onChange={(v) => (inputHub.reel = v)} />
            </div>
          </>
        )}
        {phase === 'Fight' && (
          <>
            <TapButton label="POP" size="md" onTap={() => inputHub.tap('popTap')} />
            <div className="btn-row">
              <HoldButton label="THUMB" size="lg" onChange={(v) => (inputHub.brake = v)} />
              <HoldButton label="REEL" size="xl" onChange={(v) => (inputHub.reel = v)}>
                <TensionRing tension={tension} />
              </HoldButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
