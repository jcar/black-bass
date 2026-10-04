import { m } from 'motion/react';
import { RANK_LABEL } from '../../state/career';
import { lakeName, useStore } from '../../state/store';
import { lbOz, money } from '../components';
import { CountUp, IconButton, Scene, Scorebug, Slug, rise, slideIn, stagger } from '../kit';

export function TrophyScreen() {
  const save = useStore((s) => s.save);
  const setScreen = useStore((s) => s.setScreen);
  const h = save.history;
  const wins = h.filter((r) => r.place === 1).length;
  const podiums = h.filter((r) => r.place <= 3).length;
  const earned = h.reduce((a, r) => a + r.payout, 0);

  return (
    <>
      <Scene id="ui_trophy" dim="left" />
      <div className="stage">
        <div className="topbar">
          <IconButton name="back" label="Back to marina" cue="back" onClick={() => setScreen('hub')} />
          <Slug size="lg">Trophy room</Slug>
          <div className="spacer" />
          <Scorebug items={[{ label: 'Rank', value: RANK_LABEL[save.player.rank], accent: true }]} />
        </div>

        <div className="row grow" style={{ alignItems: 'stretch', gap: 18, minHeight: 0 }}>
          <m.div className="col" style={{ gap: 14, width: 'min(300px, 34vw)', justifyContent: 'center' }} {...stagger(0.1, 0.08)}>
            <m.div {...rise}>
              <div className="kicker">Biggest bass</div>
              <div style={{ fontSize: 'clamp(46px, 7vw, 72px)', lineHeight: 0.95 }}>
                <CountUp value={save.personalBests.bigFishLb} from={0} format={lbOz} />
                <span className="unit">lb</span>
              </div>
            </m.div>
            <m.div {...rise}>
              <div className="kicker">Best one-day bag</div>
              <div style={{ fontSize: 'clamp(34px, 5vw, 50px)', lineHeight: 0.95 }}>
                <CountUp value={save.personalBests.bestBagLb} from={0} format={lbOz} delay={0.1} />
                <span className="unit">lb</span>
              </div>
            </m.div>
            <m.div {...rise}>
              <Scorebug
                items={[
                  { label: 'Events', value: h.length },
                  { label: 'Wins', value: wins, icon: 'trophy' },
                  { label: 'Top 3', value: podiums },
                  { label: 'Earned', value: money(earned) },
                ]}
              />
            </m.div>
          </m.div>

          <div className="col grow" style={{ justifyContent: 'center', gap: 4, minWidth: 0 }}>
            <div className="kicker" style={{ marginBottom: 4 }}>
              Recent results
            </div>
            {h.length === 0 ? (
              <p className="muted">No events fished yet. Your results will hang here.</p>
            ) : (
              <m.div className="col" style={{ gap: 4 }} {...stagger(0.15, 0.05)}>
                {h.slice(0, 7).map((r, i) => (
                  <m.div key={i} {...slideIn} className={`lb-row ${r.place === 1 ? 'lead' : ''}`}>
                    <span className="lb-place">{r.place}</span>
                    <span className="lb-name">
                      {lakeName(r.lakeId)} <span className="lb-today">· {r.date}</span>
                    </span>
                    <span className="lb-w">{lbOz(r.totalLb)}</span>
                    <span className="lb-today" style={{ minWidth: 64, textAlign: 'right' }}>
                      {r.payout ? money(r.payout) : `of ${r.fieldSize}`}
                    </span>
                  </m.div>
                ))}
              </m.div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
