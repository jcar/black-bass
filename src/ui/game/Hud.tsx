import { LIVEWELL_LIMIT } from '../../sim/livewell';
import { inputHub } from '../../game/input';
import type { Hud as HudData } from '../../state/store';
import { useStore } from '../../state/store';
import { lbOz } from '../components';

function staminaStage(s: number) {
  // Four stages, like the NES fish icon: normal, thinner, very thin, bones.
  return s > 0.75 ? 'Fresh' : s > 0.5 ? 'Tiring' : s > 0.25 ? 'Worn out' : 'Beat';
}

export function Hud({ hud, debug }: { hud: HudData; debug: boolean }) {
  const setPaused = useStore((s) => s.setPaused);
  const selectRod = useStore((s) => s.selectRod);
  const slots = Array.from({ length: LIVEWELL_LIMIT }, (_, i) => hud.livewell[i]);
  const showRods = hud.phase === 'Navigate' || (hud.phase === 'Cast' && !hud.castFlying && !hud.castCharging);
  const tensionColor = hud.tension > 0.85 ? 'var(--bad)' : hud.tension > 0.6 ? 'var(--accent)' : 'var(--good)';

  return (
    <>
      <div className="hud-top">
        <div className="hud-box">
          <div className="hud-clock">{hud.clock}</div>
          <div className="small muted">
            Day {hud.day}/{hud.totalDays} · {hud.motor === 'outboard' ? 'Outboard' : 'Trolling motor'}
          </div>
        </div>
        <div className="hud-box livewell">
          {slots.map((f, i) => (
            <div key={i} className={`lw-slot ${f ? 'full' : ''}`}>
              {f ? f.weightLb.toFixed(1) : ''}
            </div>
          ))}
          <div className="hud-bag">{lbOz(hud.bag)}</div>
        </div>
        <div className="hud-box">
          <div style={{ fontWeight: 900, fontSize: 18 }}>
            #{hud.place}
            <span className="small muted">/{hud.fieldSize}</span>
          </div>
          <div className="small muted">Leader {lbOz(hud.leaders[0]?.total ?? 0)}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="Pause" onClick={() => setPaused(true)}>
          II
        </button>
      </div>

      {hud.phase === 'Fight' && (
        <div className="fight-panel hud-box col" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{hud.fishName}</strong>
            <span className="small">{staminaStage(hud.stamina)}</span>
          </div>
          <div className="small muted">Line tension</div>
          <div className="meter">
            <div style={{ width: `${Math.min(100, hud.tension * 100)}%`, background: tensionColor }} />
          </div>
          <div className="small muted">Fish energy</div>
          <div className="meter">
            <div style={{ width: `${hud.stamina * 100}%`, background: '#63e6ff' }} />
          </div>
        </div>
      )}

      {hud.phase === 'Present' && debug && (
        <div className="fight-panel hud-box col" style={{ gap: 4 }}>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <strong>Attraction {hud.meter.toFixed(1)} / 10</strong>
            <span>
              Action match {(hud.match * 100).toFixed(0)}% · {hud.lureDepth.toFixed(1)} ft
            </span>
          </div>
          <div className="meter">
            <div style={{ width: `${hud.meter * 10}%`, background: hud.meter >= 6 ? 'var(--bad)' : 'var(--accent)' }} />
          </div>
        </div>
      )}

      {hud.jumping && (
        <button className="bow-prompt" onPointerDown={() => inputHub.tap('bowFlick')}>
          JUMP! BOW ↓
        </button>
      )}

      {hud.nearWaypoint && (
        <div className="tip-card hud-box col" style={{ gap: 4 }}>
          <strong style={{ color: 'var(--accent)' }}>📍 {hud.nearWaypoint.name}</strong>
          <span className="small">{hud.nearWaypoint.tip}</span>
        </div>
      )}

      {showRods && (
        <div className="rod-bar">
          {hud.rodLabels.map((l, i) => (
            <button key={i} className={`rod-chip ${i === hud.activeRod ? 'on' : ''}`} onClick={() => selectRod(i)}>
              {i + 1} {l}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
