// Pro advice panels. Every recommendation comes from src/sim/advisor.ts, which predicts bites from the
// same strike model the fish use, checked against human-like play by tools/advisor-check.ts.
import { useMemo } from 'react';
import { LAKES } from '../data/lakes';
import { COLORS, LURES, lureKey } from '../data/lures';
import { lineLabel, RODS } from '../data/rods';
import { APPROACH_TIP, dayOutlook, dayPlan, rigIssues, rodNeed, scoutLake, suggestedRod, techniqueTip, WINDOWS, type WindowId } from '../sim/advisor';
import { getLakeGrid, nearCover } from '../sim/lake';
import { adviceFor } from '../sim/tierAdvice';
import type { Conditions, RodSetup, Tier } from '../sim/types';
import { tierOfLake } from '../state/career';
import { useStore } from '../state/store';
import { LureIcon, money } from './components';
import { Button, Icon, Sheet } from './kit';

/** The cover a technique tip talks about: what's within a short cast of the stop. */
const COVER_NEAR_M = 25;

const WINDOW_LABEL = Object.fromEntries(WINDOWS.map((w) => [w.id, w.label])) as Record<WindowId, string>;

/** Pre-tournament scouting report for a lake: what the fish respond to across its tournament season. */
export function ScoutingSheet({ lakeId, open, onClose, onRigUp }: { lakeId: string; open: boolean; onClose: () => void; onRigUp?: () => void }) {
  const save = useStore((s) => s.save);
  const lake = LAKES[lakeId];
  if (!lake) return null;
  return (
    <Sheet open={open} onClose={onClose} title={`Scouting · ${lake.name}`} footer={onRigUp && <Button variant="primary" haptic onClick={onRigUp}>Rig up <Icon name="next" /></Button>}>
      {open && <ScoutingReport lakeId={lakeId} spots={adviceFor(tierOfLake(lakeId)).scoutSpots} />}
      {open && <RigCheck lakeId={lakeId} deck={save.deck} />}
    </Sheet>
  );
}

/**
 * The scouting report body: the lake's best baits across its event season, how to rig them and when
 * they work. `spots` adds where (the lower tiers); the Pro and Elite series find their own water.
 */
export function ScoutingReport({ lakeId, spots }: { lakeId: string; spots: boolean }) {
  const save = useStore((s) => s.save);
  const lake = LAKES[lakeId];
  const report = useMemo(() => (lake ? scoutLake(lake) : null), [lake]);
  if (!lake || !report) return null;
  const top = report.picks.slice(0, 4);
  const best = top[0]?.score ?? 1;
  const timber = lake.cover.some((p) => p.type === 'standing');
  return (
    <>
      <p className="small muted">
        Event season: {report.seasons.slice(0, 3).join(', ')} · water {report.tempRange[0]}-{report.tempRange[1]}°F · {lake.clarity.defaultSecchiFt} ft visibility. Ranked by how the fish respond to each bait across those days.
        {!spots && ' Pros find their own water: no spots in this report.'}
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
                {COLORS[p.colorId].name} · {lineLabel(p.line)} · {rod ? RODS[rod].name : `needs ${rodNeed(p.lureId)}`}
                {!owned && <span className="muted"> · shop {money(LURES[p.lureId].price)}</span>}
              </span>
              <span className="small muted">{p.reasons.join(' · ')}</span>
              {spots && p.spots.length > 0 && (
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
    </>
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

/**
 * Briefing plan: which of your rigs to throw in each part of today, and how to work it. What it shows
 * depends on the tier (adviceFor): the lower series get where too, the Pro series only the lures.
 */
export function DayPlan({ lakeId, conditions, deck, tier, compact }: { lakeId: string; conditions: Conditions; deck: RodSetup[]; tier: Tier; compact?: boolean }) {
  const access = adviceFor(tier);
  const spots = access.plan === 'full';
  const plan = useMemo(() => dayPlan(LAKES[lakeId], conditions, deck), [lakeId, conditions, deck]);
  const coachOn = useStore((s) => s.save.settings.coach);
  const outlook = useMemo(() => (compact ? null : dayOutlook(LAKES[lakeId], conditions, deck, spots)), [lakeId, conditions, deck, compact, spots]);
  if (access.plan === 'scouting') return null;
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
        {APPROACH_TIP}{' '}
        {spots
          ? coachOn && access.proStops > 0 && `The best stops for the rod in your hand are marked PRO 1-${access.proStops} on the map.`
          : 'Pros find their own water: the plan says what to throw and when, not where.'}
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
              {spots && (
                <span className="small">
                  <strong>Where:</strong> {p.spot.spot.name} ({p.spot.why})
                </span>
              )}
              <span className="small muted">{techniqueTip(d.lureId, conditions.waterTempF, spots ? nearCover(getLakeGrid(LAKES[lakeId]), p.spot.spot.x, p.spot.spot.y, COVER_NEAR_M) : undefined)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
