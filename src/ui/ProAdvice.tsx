// Pro advice panels. Every recommendation comes from src/sim/advisor.ts, which predicts bites from the
// same strike model the fish use, checked against human-like play by tools/advisor-check.ts.
import { useMemo } from 'react';
import { LAKES } from '../data/lakes';
import { COLORS, LURES, lureKey } from '../data/lures';
import { lineLabel, RODS } from '../data/rods';
import { APPROACH_TIP, dayOutlook, dayPlan, rigIssues, scoutLake, suggestedRod, techniqueTip, WINDOWS, type WindowId } from '../sim/advisor';
import type { Conditions, RodSetup } from '../sim/types';
import { useStore } from '../state/store';
import { LureIcon, money } from './components';
import { Button, Icon, Sheet } from './kit';

const WINDOW_LABEL = Object.fromEntries(WINDOWS.map((w) => [w.id, w.label])) as Record<WindowId, string>;

/** Pre-tournament scouting report for a lake: what the fish respond to across its tournament season. */
export function ScoutingSheet({ lakeId, open, onClose, onRigUp }: { lakeId: string; open: boolean; onClose: () => void; onRigUp?: () => void }) {
  const save = useStore((s) => s.save);
  const lake = LAKES[lakeId];
  const report = useMemo(() => (lake && open ? scoutLake(lake) : null), [lake, open]);
  if (!lake) return null;
  const top = report?.picks.slice(0, 4) ?? [];
  const best = top[0]?.score ?? 1;
  const timber = lake.cover.some((p) => p.type === 'standing');
  return (
    <Sheet open={open} onClose={onClose} title={`Scouting · ${lake.name}`} footer={onRigUp && <Button variant="primary" haptic onClick={onRigUp}>Rig up <Icon name="next" /></Button>}>
      {report && (
        <>
          <p className="small muted">
            Event season: {report.seasons.slice(0, 3).join(', ')} · water {report.tempRange[0]}-{report.tempRange[1]}°F · {lake.clarity.defaultSecchiFt} ft visibility. Ranked by how the fish respond to each bait across those days.
          </p>
          {top.map((p, i) => {
            const owned = save.ownedLures.includes(lureKey(p.lureId, p.colorId));
            const rod = suggestedRod(p.lureId, save.ownedRods);
            return (
              <div key={p.lureId} className="advice-row">
                <LureIcon lureId={p.lureId} colorId={p.colorId} size={54} />
                <div className="col" style={{ gap: 3, minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
                    <span className="display" style={{ fontSize: 18 }}>
                      {i + 1}. {LURES[p.lureId].name}
                    </span>
                    <span className="num small" style={{ color: 'var(--accent)' }}>
                      {Math.round((p.score / best) * 100)}
                    </span>
                  </div>
                  <span className="small">
                    {COLORS[p.colorId].name} · {lineLabel(p.line)} · {rod ? RODS[rod].name : `needs a ${LURES[p.lureId].weightOz} oz rod`}
                    {!owned && <span className="muted"> · shop {money(LURES[p.lureId].price)}</span>}
                  </span>
                  <span className="small muted">{p.reasons.join(' · ')}</span>
                  {p.spots.length > 0 && (
                    <span className="small">
                      <strong>Where:</strong> {p.spots.map((s) => s.spot.name).join(' · ')}
                    </span>
                  )}
                  <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {p.windows.map((w) => (
                      <span key={w} className="badge">
                        {WINDOW_LABEL[w]}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="col small" style={{ gap: 4 }}>
            <span className="kicker">Gear</span>
            {timber && <span>Standing timber: 15 lb+ fluoro or braid. Lighter line wraps and frays when a fish runs into the trunks.</span>}
            <span>{lake.clarity.defaultSecchiFt >= 8 ? 'Clear water: fluorocarbon is invisible; mono costs ~4% of bites and braid ~10% on subsurface baits.' : 'Stained water: line visibility doesn’t matter; vibration and bright or dark colours carry further.'}</span>
            <span>Match lure weight to the rod's range or casts lose 18% distance.</span>
            <span>{APPROACH_TIP}</span>
          </div>
          <RigCheck lakeId={lakeId} deck={save.deck} />
        </>
      )}
    </Sheet>
  );
}

/** What a pro would change on each of your rigs for this lake. */
export function RigCheck({ lakeId, deck, firstRod = 1 }: { lakeId: string; deck: RodSetup[]; firstRod?: number }) {
  const lake = LAKES[lakeId];
  const issues = deck.map((d) => rigIssues(lake, d));
  if (!issues.some((x) => x.length)) return <p className="small" style={{ color: 'var(--good)' }}>Your rigs pass a pro's check for this lake.</p>;
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="kicker">Your rigs</span>
      {deck.map((d, i) =>
        issues[i].map((x, k) => (
          <div key={`${i}-${k}`} className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
            <LureIcon lureId={d.lureId} colorId={d.colorId} size={26} />
            <span>
              <strong>Rod {i + firstRod}:</strong> <span style={{ color: x.severity === 'warn' ? 'var(--accent)' : undefined }}>{x.text}</span>
            </span>
          </div>
        )),
      )}
    </div>
  );
}

/** Briefing plan: which of your rigs to throw in each part of today, and how to work it. */
export function DayPlan({ lakeId, conditions, deck, compact }: { lakeId: string; conditions: Conditions; deck: RodSetup[]; compact?: boolean }) {
  const plan = useMemo(() => dayPlan(LAKES[lakeId], conditions, deck), [lakeId, conditions, deck]);
  const coachOn = useStore((s) => s.save.settings.coach);
  const outlook = useMemo(() => (compact ? null : dayOutlook(LAKES[lakeId], conditions, deck)), [lakeId, conditions, deck, compact]);
  if (compact)
    return (
      <div className="row plan-strip" style={{ gap: 6 }}>
        {plan.map((p) => (
          <div key={p.window.id} className="plan-chip" title={`${p.window.label}: ${LURES[deck[p.best].lureId].name}`}>
            <span className="kicker">{p.window.label}</span>
            <LureIcon lureId={deck[p.best].lureId} colorId={deck[p.best].colorId} size={38} />
            <span className="num plan-rod">{p.best + 1}</span>
          </div>
        ))}
      </div>
    );
  return (
    <div className="col" style={{ gap: 8 }}>
      {outlook && (
        <p className="small" style={{ color: outlook.tough ? 'var(--accent)' : undefined, margin: 0 }}>
          {outlook.text}
        </p>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {APPROACH_TIP} {coachOn && 'The best stops for the rod in your hand are marked PRO 1-6 on the map.'}
      </p>
      {plan.map((p) => {
        const d = deck[p.best];
        const sorted = [...p.scores].sort((a, b) => b - a);
        const edge = sorted[1] ? Math.round((sorted[0] / sorted[1] - 1) * 100) : 0;
        return (
          <div key={p.window.id} className="advice-row">
            <LureIcon lureId={d.lureId} colorId={d.colorId} size={46} />
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="display" style={{ fontSize: 17 }}>
                {p.window.label} · Rod {p.best + 1}: {LURES[d.lureId].name}
                {edge >= 5 && <span className="small muted"> (+{edge}% over your next best)</span>}
              </span>
              <span className="small">
                <strong>Where:</strong> {p.spot.spot.name} ({p.spot.why})
              </span>
              <span className="small muted">{techniqueTip(d.lureId, conditions.waterTempF)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
