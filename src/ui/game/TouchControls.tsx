import { useRef, useState } from 'react';
import { inputHub } from '../../game/input';
import { unlockAudio } from '../../audio/sound';
import type { Hud } from '../../state/store';

const STICK_R = 60;

/** Hold-to-act button (REEL, THUMB): pointer capture so sliding a thumb off doesn't stick it on. */
function HoldButton({ label, size, onChange }: { label: string; size: 'xl' | 'lg' | 'md'; onChange: (down: boolean) => void }) {
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
      {label}
    </button>
  );
}

function TapButton({ label, size, onTap, disabled, accent }: { label: string; size: 'xl' | 'lg' | 'md'; onTap: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button
      className={`tbtn ${size} ${accent ? 'accent' : ''}`}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        unlockAudio();
        if (!disabled) onTap();
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
export function TouchControls({ hud, leftHanded }: { hud: Hud; leftHanded: boolean }) {
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const touch = useRef<{ id: number; t0: number; x0: number; y0: number } | null>(null);
  const phase = hud.phase;

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
        {phase === 'Navigate' && <TapButton label="FISH" size="xl" accent disabled={!hud.canFish} onTap={() => inputHub.tap('fishHere')} />}
        {phase === 'Cast' && (
          <>
            {!hud.castFlying && <TapButton label="MOVE" size="md" onTap={() => inputHub.tap('moveOn')} />}
            <div className="btn-row">
              {hud.castFlying ? (
                <HoldButton label="THUMB" size="xl" onChange={(v) => (inputHub.brake = v)} />
              ) : (
                <TapButton label={hud.castCharging ? 'RELEASE' : 'CAST'} size="xl" accent onTap={() => inputHub.tap('castTap')} />
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
              <HoldButton label="REEL" size="xl" onChange={(v) => (inputHub.reel = v)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
