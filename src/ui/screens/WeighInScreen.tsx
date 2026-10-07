import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { LAKE_LADDER, PURSE, TIER_FORMAT, payoutFor } from '../../data/lakes';
import { SPECIES } from '../../data/species';
import { playUi, stopUi } from '../../audio/sound';
import { assetUrl, portraitId } from '../../game/assets';
import { PROMOTE_TOP } from '../../state/career';
import type { Standing } from '../../sim/field';
import { isTournamentOver, playerCut, standings } from '../../sim/tournament';
import type { CaughtFish } from '../../sim/types';
import { lakeName, useStore } from '../../state/store';
import { lbOz, money } from '../components';
import { Button, CountUp, Icon, Scene, Slug, spring } from '../kit';

/**
 * The weigh-in, staged like a Bassmaster broadcast: the field's bags come in, the leader takes the
 * Hot Seat, your fish go on the scale one at a time, and you either bump the leader or you don't.
 * Pure presentation over the final standings; nothing here changes the tournament.
 */
enum Phase {
  Intro,
  Weigh,
  Verdict,
  Board,
  Payout,
  Done,
}

const SHOWN = 6;
const sortRows = (rows: Standing[]) => rows.sort((a, b) => Number(a.cut) - Number(b.cut) || b.total - a.total);

function FishThumb({ f, small }: { f: CaughtFish; small?: boolean }) {
  const url = assetUrl(portraitId(f.species, f.weightLb));
  return (
    <div className={`fish-thumb ${f.cwr ? 'cwr' : ''}`} style={small ? { width: 70, height: 50 } : undefined} title={f.cwr ? `${SPECIES[f.species].name} (slot fish: weighed and released)` : SPECIES[f.species].name}>
      {url && <img src={url} alt="" />}
      <span className="fw">{lbOz(f.weightLb)}</span>
    </div>
  );
}

export function WeighInScreen() {
  const t = useStore((s) => s.tournament);
  const save = useStore((s) => s.save);
  const notes = useStore((s) => s.debrief);
  const mutateSave = useStore((s) => s.mutateSave);
  const nextDay = useStore((s) => s.nextDay);
  const complete = useStore((s) => s.completeTournament);
  const seen = save.settings.seenWeighIn;
  const [phase, setPhase] = useState(Phase.Intro);
  const [weighed, setWeighed] = useState(0);

  const data = useMemo(() => {
    if (!t) return null;
    const final = standings(t, true);
    const me = final.find((r) => r.isPlayer)!;
    const before = sortRows(final.map((r) => (r.isPlayer ? { ...r, total: Math.round((r.total - r.today) * 100) / 100 } : { ...r })));
    const leader = final.find((r) => !r.isPlayer && !r.cut) ?? final.find((r) => !r.isPlayer)!;
    const bag = [...t.livewell].sort((a, b) => a.weightLb - b.weightLb);
    const place = final.indexOf(me) + 1;
    const over = isTournamentOver(t);
    const purse = PURSE[t.tier];
    const idx = LAKE_LADDER.findIndex((l) => l.id === t.lakeId);
    const next = LAKE_LADDER[idx + 1];
    const big = bag[bag.length - 1];
    // Big Bass of the day across the whole field (rivals catch real fish now).
    let fieldBig = { name: 'You', weightLb: big?.weightLb ?? 0, isPlayer: true };
    for (const r of t.rivals)
      for (const c of r.catches) if (!r.cut && c.weightLb > fieldBig.weightLb) fieldBig = { name: r.name, weightLb: c.weightLb, isPlayer: false };
    return {
      fieldBig,
      final,
      before,
      me,
      leader,
      bag,
      place,
      over,
      cut: playerCut(t),
      bumped: me.total > leader.total,
      payout: over ? payoutFor(t.tier, place) : 0,
      points: over ? (purse.points[place - 1] ?? 10) : 0,
      promotes: over && place <= PROMOTE_TOP && !!next && !save.unlockedLakes.includes(next.id) ? next.name : null,
      missedPromotion:
        over && place > PROMOTE_TOP && !!next && !save.unlockedLakes.includes(next.id)
          ? { name: next.name, shortLb: Math.max(0.01, final[PROMOTE_TOP - 1].total - me.total) }
          : null,
      recordBag: me.today > 0 && me.today > save.personalBests.bestBagLb,
      recordFish: !!big && big.weightLb > save.personalBests.bigFishLb,
      big,
      moneyLine: purse.payouts.length,
      cutLine: t.cutAfterDay && t.day === t.cutAfterDay ? TIER_FORMAT[t.tier].cutTo : null,
    };
    // Snapshot once: completing the tournament mutates the save underneath us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // ---- Timeline ----
  useEffect(() => {
    if (!data) return;
    const go = (p: Phase, ms: number) => setTimeout(() => setPhase(p), ms);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (phase === Phase.Intro) timer = go(Phase.Weigh, 1500);
    if (phase === Phase.Weigh) {
      if (weighed < data.bag.length) {
        timer = setTimeout(
          () => {
            playUi('tick');
            setWeighed((w) => w + 1);
          },
          weighed === 0 ? 500 : 520,
        );
      } else timer = go(Phase.Verdict, data.bag.length ? 1900 : 800);
    }
    if (phase === Phase.Verdict) timer = go(Phase.Board, 1800);
    if (phase === Phase.Board) timer = go(data.over ? Phase.Payout : Phase.Done, 1500);
    if (phase === Phase.Payout) timer = go(Phase.Done, 1600);
    return () => clearTimeout(timer);
  }, [phase, weighed, data]);

  // ---- Cues ----
  useEffect(() => {
    if (!data) return;
    if (phase === Phase.Weigh && data.bag.length) playUi('build');
    if (phase === Phase.Verdict) {
      stopUi('build');
      playUi(data.bumped ? 'hotseat' : 'hold');
    }
    if (phase === Phase.Payout) playUi(data.promotes ? 'promote' : data.recordBag || data.recordFish ? 'record' : 'confirm');
    if (phase === Phase.Done && !seen) mutateSave((s) => void (s.settings.seenWeighIn = true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (!t || !data) return null;
  const skip = () => {
    if (phase === Phase.Done || !seen) return;
    stopUi('build');
    setWeighed(data.bag.length);
    setPhase(Phase.Done);
  };

  const reordered = phase >= Phase.Board;
  const rows = reordered ? data.final : data.before;
  const top = rows.slice(0, SHOWN);
  const myRow = rows.find((r) => r.isPlayer)!;
  const myIdx = rows.indexOf(myRow);
  const showMeBelow = myIdx >= SHOWN && phase >= Phase.Weigh;
  const scaleValue = data.bag.slice(0, weighed).reduce((a, f) => a + f.weightLb, 0);
  const allIn = weighed >= data.bag.length;
  const seatHolder = phase >= Phase.Verdict && data.bumped ? data.me : data.leader;
  const lineAt = data.cutLine ?? (data.over ? data.moneyLine : null);
  const lineLabel = data.cutLine ? 'Cut line' : 'Money line';

  const row = (r: Standing, place: number) => (
    <m.div
      layout="position"
      key={r.id}
      className={`lb-row ${r.isPlayer ? 'me' : ''} ${place === 1 ? 'lead' : ''} ${r.cut ? 'out' : ''}`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={spring}
    >
      <span className="lb-place">{place}</span>
      <span className="lb-name">{r.isPlayer ? 'You' : r.name}</span>
      <span className="lb-today">{r.isPlayer && !reordered ? (phase >= Phase.Weigh ? 'on the scale' : '') : `+${lbOz(r.today)}`}</span>
      <span className="lb-w">{lbOz(r.total)}</span>
    </m.div>
  );

  return (
    <>
      <Scene id="ui_stage" dim="full" />
      <div className="tap-skip" onClick={skip} />
      <div className="stage" style={{ pointerEvents: 'none' }}>
        <div className="topbar">
          <Slug>
            Weigh-in · Day {t.day} of {t.totalDays}
          </Slug>
          <span className="display" style={{ fontSize: 26 }}>
            {lakeName(t.lakeId)}
          </span>
          <div className="spacer" />
          {seen && phase < Phase.Done && (
            <span className="kicker" style={{ pointerEvents: 'auto' }} onClick={skip}>
              Tap to skip
            </span>
          )}
        </div>

        <div className="row grow" style={{ alignItems: 'stretch', gap: 18, minHeight: 0 }}>
          {/* Leaderboard */}
          <div className="col" style={{ flex: 1, gap: 4, minWidth: 0, justifyContent: 'center' }}>
            <span className="kicker">Leaderboard</span>
            <LayoutGroup>
              {top.map((r, i) => (
                <div key={r.id} style={{ display: 'contents' }}>
                  {row(r, i + 1)}
                  {lineAt === i + 1 && reordered && <div className="cut-line">{lineLabel}</div>}
                </div>
              ))}
              {showMeBelow && (
                <>
                  <div className="kicker" style={{ textAlign: 'center', lineHeight: 0.6 }}>
                    · · ·
                  </div>
                  {row(myRow, myIdx + 1)}
                </>
              )}
            </LayoutGroup>
            {reordered && lineAt && myIdx + 1 > lineAt && data.final[lineAt - 1] && (
              <m.span className="small muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {lbOz(Math.max(0, data.final[lineAt - 1].total - data.me.total))} lb short of the {lineLabel.toLowerCase()}.
              </m.span>
            )}
          </div>

          {/* Scale, hot seat, result */}
          <div className="col" style={{ flex: 1.05, gap: 10, minWidth: 0, justifyContent: 'center', alignItems: 'flex-start', paddingBottom: phase >= Phase.Board ? 64 : 0 }}>
            <AnimatePresence initial={false}>
              {phase < Phase.Board && (
                <m.div className="hot-seat" exit={{ opacity: 0, height: 0, marginBottom: -10, paddingTop: 0, paddingBottom: 0 }} transition={{ duration: 0.3 }}>
                  <div className="seat">
                    <Icon name="trophy" />
                  </div>
                  <div className="col" style={{ gap: 0 }}>
                    <span className="kicker" style={{ color: 'var(--gold)' }}>
                      Hot seat
                    </span>
                    <AnimatePresence mode="popLayout">
                      <m.span key={seatHolder.id} className="display" style={{ fontSize: 22 }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={spring}>
                        {seatHolder.isPlayer ? 'You' : seatHolder.name} · {lbOz(seatHolder.total)}
                      </m.span>
                    </AnimatePresence>
                  </div>
                </m.div>
              )}
            </AnimatePresence>

            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <div className="scale-readout">
                {phase >= Phase.Weigh ? <CountUp value={allIn ? data.me.today : scaleValue} format={(n) => lbOz(Math.max(0, n))} duration={0.35} settle={allIn && data.bag.length > 0} /> : <span>-.--</span>}
                <span className="unit">lb</span>
              </div>
              <AnimatePresence>
                {phase === Phase.Verdict && (
                  <m.div className="col" initial={{ opacity: 0, scale: 1.3 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={spring} style={{ marginBottom: 8, gap: 6, alignItems: 'flex-start' }}>
                    {data.bag.length === 0 ? <Slug tone="dark">No keepers today</Slug> : data.bumped ? <Slug tone="gold" size="lg">New leader</Slug> : <Slug tone="dark" size="lg">{data.leader.name.split(' ')[0]} holds</Slug>}
                    {data.big && <span className="badge">Big bass · {lbOz(data.big.weightLb)}</span>}
                  </m.div>
                )}
              </AnimatePresence>
            </div>

            <AnimatePresence initial={false}>
              {phase < Phase.Board && (
                <m.div className="row" style={{ gap: 6, minHeight: 50 }} exit={{ opacity: 0, height: 0, minHeight: 0 }} transition={{ duration: 0.3 }}>
                  <AnimatePresence>
                    {data.bag.slice(0, weighed).map((f, i) => (
                      <m.div key={i} initial={{ opacity: 0, y: -24, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                        <FishThumb f={f} small />
                      </m.div>
                    ))}
                  </AnimatePresence>
                </m.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {phase >= Phase.Board && (
                <m.div className="row" style={{ gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                  <div>
                    <div className="kicker">{data.over ? 'Final' : 'Standing'}</div>
                    <div className="num" style={{ fontSize: 44, lineHeight: 0.9 }}>
                      #{data.place}
                      <span className="unit">of {data.final.length}</span>
                    </div>
                  </div>
                  {phase >= Phase.Payout && (
                    <>
                      <div>
                        <div className="kicker">{data.place <= data.moneyLine ? 'Payout' : 'Participation'}</div>
                        <div style={{ fontSize: 34, lineHeight: 0.9, color: data.payout ? 'var(--good)' : undefined }}>
                          <CountUp value={data.payout} from={0} format={(n) => money(Math.round(n))} duration={1} />
                        </div>
                      </div>
                      <span className="badge">+{data.points} pts</span>
                    </>
                  )}
                </m.div>
              )}
            </AnimatePresence>
            {phase >= Phase.Board && save.settings.coach && notes.length > 0 && (
              <m.div className="col coach-notes" style={{ gap: 4, pointerEvents: 'auto' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.4 }}>
                <span className="kicker">Coach's notes</span>
                {notes.map((n, i) => (
                  <span key={i} className="small">
                    {n}
                  </span>
                ))}
              </m.div>
            )}
            {phase >= Phase.Payout && (
              <m.div className="row" style={{ gap: 6, flexWrap: 'wrap' }} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring, delay: 0.5 }}>
                {data.fieldBig.weightLb > 0 && (
                  <Slug tone={data.fieldBig.isPlayer ? 'gold' : 'dark'}>
                    Big bass · {data.fieldBig.isPlayer ? 'You' : data.fieldBig.name} {lbOz(data.fieldBig.weightLb)}
                  </Slug>
                )}
                {data.promotes && <Slug tone="gold">Promoted · {data.promotes} unlocked</Slug>}
                {data.missedPromotion && (
                  <Slug tone="dark">
                    Top {PROMOTE_TOP} advances to {data.missedPromotion.name} · {lbOz(data.missedPromotion.shortLb)} short
                  </Slug>
                )}
                {data.recordBag && <Slug tone="good">Personal best bag</Slug>}
                {data.recordFish && <Slug tone="good">Personal best fish</Slug>}
              </m.div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {phase === Phase.Done && (
          <m.div className="thumb-zone" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
            {data.over ? (
              <Button variant="primary" size="lg" skew haptic onClick={complete}>
                <span>{data.cut ? 'Missed the cut · Marina' : data.place <= data.moneyLine ? 'Collect winnings' : 'Back to the marina'}</span>
                <Icon name="next" />
              </Button>
            ) : (
              <Button variant="primary" size="lg" skew haptic onClick={nextDay}>
                <span>Start day {t.day + 1}</span>
                <Icon name="next" />
              </Button>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
