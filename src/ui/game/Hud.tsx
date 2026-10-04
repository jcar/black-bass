import { AnimatePresence, m } from 'motion/react';
import { memo, useEffect, useState } from 'react';
import { PURSE, TIER_FORMAT } from '../../data/lakes';
import { TUNING } from '../../data/tuning';
import { inputHub } from '../../game/input';
import { LIVEWELL_LIMIT } from '../../sim/livewell';
import type { RodSetup } from '../../sim/types';
import type { Hud as HudData } from '../../state/store';
import { useStore } from '../../state/store';
import { lbOz, LureIcon } from '../components';
import { Icon, spring } from '../kit';
import { NoticeStrip } from './Notices';
import { promotionTarget } from '../../state/career';

function staminaStage(s: number) {
  // Four stages, like the NES fish icon: normal, thinner, very thin, bones.
  return s > 0.75 ? 'Fresh' : s > 0.5 ? 'Tiring' : s > 0.25 ? 'Worn out' : 'Beat';
}

const C = TUNING.clock;

/** Remembers the last place change for a few seconds so the chip can show a trend arrow. */
function usePlaceTrend(place: number): 'up' | 'down' | null {
  const [prev, setPrev] = useState(place);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  if (place !== prev) {
    setPrev(place);
    setDir(place < prev ? 'up' : 'down');
  }
  useEffect(() => {
    if (!dir) return;
    const id = setTimeout(() => setDir(null), 5000);
    return () => clearTimeout(id);
  }, [dir, place]);
  return dir;
}

const RodBar = memo(function RodBar({ labels, active, pick, deck }: { labels: string[]; active: number; pick: number; deck?: RodSetup[] }) {
  const selectRod = useStore((s) => s.selectRod);
  return (
    <div className="rod-bar">
      {labels.map((l, i) => (
        <button key={i} className={`rod-chip ${i === active ? 'on' : ''}`} onClick={() => selectRod(i)}>
          {deck?.[i] && <LureIcon lureId={deck[i].lureId} colorId={deck[i].colorId} size={34} />}
          {i + 1} {l}
          {i === pick && (
            <span className="pro-pick" title="Pro pick for this time of day and depth">
              Pro
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

export function Hud({ hud, debug }: { hud: HudData; debug: boolean }) {
  const setPaused = useStore((s) => s.setPaused);
  const deck = useStore((s) => s.tournament?.deck);
  const tier = useStore((s) => s.tournament?.tier);
  const cutDay = useStore((s) => (s.tournament && s.tournament.cutAfterDay === s.tournament.day ? TIER_FORMAT[s.tournament.tier].cutTo : null));
  const lakeId = useStore((s) => s.tournament?.lakeId);
  const unlocked = useStore((s) => s.save.unlockedLakes);
  const promo = lakeId ? promotionTarget(lakeId, unlocked) : null;
  const slots = Array.from({ length: LIVEWELL_LIMIT }, (_, i) => hud.livewell[i]);
  const showRods = hud.phase === 'Navigate' || (hud.phase === 'Cast' && !hud.castFlying && !hud.castCharging);
  const trend = usePlaceTrend(hud.place);
  const left = Math.max(0, (C.dayEndMin - hud.clockMin) / (C.dayEndMin - C.dayStartMin));
  const late = hud.clockMin >= C.warnAtMin;
  const money = tier ? PURSE[tier].payouts.length : 10;
  const line = cutDay ?? (hud.fieldSize > money ? money : null);
  const inside = line !== null && hud.place <= line;
  const tension = Math.min(1, hud.tension);

  return (
    <>
      <div className="hud-top">
        <div className="hud-left">
          <div className="scorebug">
            <div className="sb-cell clock">
              <span className="sb-label">
                Day {hud.day}/{hud.totalDays} · {hud.motor === 'outboard' ? 'Outboard' : 'Trolling'}
              </span>
              <span className={`sb-value ${late ? 'late' : ''}`}>{hud.clock}</span>
              <span className={`time-left ${late ? 'late' : ''}`} style={{ transform: `scaleX(${left})` }} />
            </div>
            <div className="sb-cell">
              <span className="sb-label">Livewell</span>
              <div className="livewell">
                {slots.map((f, i) => (
                  <div key={i} className={`lw-slot ${f ? 'full' : ''} ${f?.cwr ? 'cwr' : ''}`} title={f?.cwr ? 'Slot fish: weighed and released' : undefined}>
                    {f ? lbOz(f.weightLb) : ''}
                  </div>
                ))}
              </div>
            </div>
            <div className="sb-cell accent">
              <span className="sb-label">Bag</span>
              <span className="sb-value">{lbOz(hud.bag)}</span>
            </div>
            <div className="sb-cell">
              <span className={`sb-label ${promo && hud.place <= promo.place ? 'advancing' : ''}`}>
                {promo
                  ? hud.place <= promo.place
                    ? 'Advancing'
                    : `Top ${promo.place} advances`
                  : line !== null
                    ? inside
                      ? cutDay
                        ? 'Inside cut'
                        : 'In the money'
                      : cutDay
                        ? `Cut #${line}`
                        : `Money #${line}`
                    : 'Place'}
              </span>
              <span className="sb-value">
                #{hud.place}
                <span className="unit">/{hud.fieldSize}</span>
                <AnimatePresence>
                  {trend && (
                    <m.span key={`${trend}${hud.place}`} className={`trend ${trend}`} initial={{ opacity: 0, y: trend === 'up' ? 6 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      {trend === 'up' ? '▲' : '▼'}
                    </m.span>
                  )}
                </AnimatePresence>
              </span>
            </div>
          </div>
          <NoticeStrip hold={hud.phase === 'Fight' || hud.phase === 'Landed'} />
        </div>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="Pause" onClick={() => setPaused(true)}>
          <Icon name="pause" />
        </button>
      </div>

      <AnimatePresence>
        {hud.phase === 'Fight' && (
          <m.div className="fight-panel hud-box" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={spring}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <span className="fight-name">{hud.fishName === 'Unknown fish' ? 'Fish on' : hud.fishName}</span>
              <span className={`badge ${hud.stamina < 0.25 ? 'good' : ''}`}>{staminaStage(hud.stamina)}</span>
            </div>
            <div className="meter" aria-label="Fish energy">
              <div style={{ transform: `scaleX(${hud.stamina})`, background: '#63e6ff' }} />
            </div>
            <div className={`fight-line ${tension > 0.85 ? 'danger' : tension > 0.6 ? 'warn' : ''}`}>
              Line {Math.round(tension * 100)}%{tension > 0.85 ? ' · ease off' : ''}
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {hud.phase === 'Present' && debug && (
        <div className="fight-panel hud-box col" style={{ gap: 4 }}>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <strong>Attraction {hud.meter.toFixed(1)} / 10</strong>
            <span>{(hud.match * 100).toFixed(0)}% match</span>
          </div>
          <div className="meter">
            <div style={{ transform: `scaleX(${Math.min(1, hud.meter / 10)})`, background: hud.meter >= 6 ? 'var(--bad)' : 'var(--accent)' }} />
          </div>
        </div>
      )}

      {hud.jumping && (
        <button className="bow-prompt" onPointerDown={() => inputHub.tap('bowFlick')}>
          Jump! Bow ↓
        </button>
      )}

      {hud.nearWaypoint && (
        <div className="tip-card hud-box col" style={{ gap: 4 }}>
          <strong className="row" style={{ color: 'var(--accent)', gap: 6 }}>
            <Icon name="pin" /> {hud.nearWaypoint.name}
          </strong>
          <span className="small">{hud.nearWaypoint.tip}</span>
        </div>
      )}

      {showRods && <RodBar labels={hud.rodLabels} active={hud.activeRod} pick={hud.proPick} deck={deck} />}
    </>
  );
}
