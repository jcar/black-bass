import { memo, useRef, useState, type ReactNode } from 'react';
import { inputHub } from '../../game/input';
import { unlockAudio } from '../../audio/sound';
import type { GamePhase } from '../../sim/types';
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
  const cls = t > 0.85 ? 'danger' : t > 0.6 ? 'warn' : '';
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

function TapButton({ label, size, onTap, disabled, accent, haptic }: { label: string; size: 'xl' | 'lg' | 'md'; onTap: () => void; disabled?: boolean; accent?: boolean; haptic?: boolean }) {
  // On iPhone the haptic comes from the user's own tap toggling a switch inside a label; the action
  // itself still fires on pointerdown so there's no tap delay.
  if (haptic && IOS)
    return (
      <label
        role="button"
        aria-disabled={disabled}
        className={`tbtn ${size} ${accent ? 'accent' : ''} ${disabled ? 'disabled' : ''}`}
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
      className={`tbtn ${size} ${accent ? 'accent' : ''}`}
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
  castFlying: boolean;
  castCharging: boolean;
  /** Rounded to 2 decimals by the caller so the memo holds between meaningful changes. */
  tension: number;
  leftHanded: boolean;
}

/** Memoised: the HUD snapshot ticks at 10 Hz, but the controls only change with these props. */
export const TouchControls = memo(function TouchControls({ phase, canFish, castFlying, castCharging, tension, leftHanded }: ControlsProps) {
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

  const hint =
    phase === 'Navigate'
      ? 'Drag to drive · light push = quiet trolling motor'
      : phase === 'Cast'
        ? 'Drag left/right to aim'
        : phase === 'Present'
          ? 'Tap to twitch / hop · drag sideways to steer'
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
        {phase === 'Navigate' && <TapButton label="FISH" size="xl" accent haptic disabled={!canFish} onTap={() => inputHub.tap('fishHere')} />}
        {phase === 'Cast' && (
          <>
            {!castFlying && <TapButton label="MOVE" size="md" onTap={() => inputHub.tap('moveOn')} />}
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
