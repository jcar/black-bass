import { m } from 'motion/react';
import { useState } from 'react';
import { LAKES, TIER_FORMAT } from '../../data/lakes';
import { unlockAudio } from '../../audio/sound';
import { plateId } from '../../game/assets';
import { canRerig, useStore } from '../../state/store';
import { promotionTarget } from '../../state/career';
import { DayPlan } from '../ProAdvice';
import { HowToFishSheet, ProPlanSheet } from '../HelpSheets';
import type { Weather } from '../../sim/types';
import { keeperMinIn } from '../../sim/livewell';
import { conditionsAdvice } from '../advice';
import { Button, Icon, LowerThird, Scene, Scorebug, Slug, rise, stagger, type IconName } from '../kit';

const SKY_ICON: Record<Weather, IconName> = { Bluebird: 'sun', Overcast: 'cloud', Windy: 'wind', Rain: 'rain' };
const SERIES = { Amateur: 'Co-Angler Series', SemiPro: 'Semi-Pro Series', Pro: 'Pro Series', Elite: 'Elite Series' } as const;

/** Pre-show: today's lake and weather as the backdrop, conditions as a broadcast strip. */
export function BriefingScreen() {
  const t = useStore((s) => s.tournament);
  const setScreen = useStore((s) => s.setScreen);
  const launchDay = useStore((s) => s.launchDay);
  const [howTo, setHowTo] = useState(false);
  const [plan, setPlan] = useState(false);
  const unlocked = useStore((s) => s.save.unlockedLakes);
  if (!t) return null;
  const lake = LAKES[t.lakeId];
  const c = t.conditions;
  const fmt = TIER_FORMAT[t.tier];
  const date = new Date(`${c.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const tips = conditionsAdvice(c, lake).slice(0, 3);
  const minIn = keeperMinIn(lake);
  const promo = promotionTarget(t.lakeId, unlocked);
  const slot = lake.regs?.slot;

  return (
    <>
      <Scene id={plateId(t.lakeId, c.weather, 'none')} dim="left" />
      <div className="stage">
        <div className="topbar">
          <Slug>
            {SERIES[t.tier]} · Day {t.day} of {t.totalDays}
          </Slug>
          <div className="spacer" />
          <Button size="md" cue="open" onClick={() => setPlan(true)}>
            <Icon name="fish" /> Pro plan
          </Button>
          <Button size="md" cue="open" onClick={() => setHowTo(true)}>
            <Icon name="info" /> How to fish
          </Button>
        </div>

        <LowerThird kicker="Today on the water" title={lake.name} sub={lake.blurb} delay={0.15} />
        <m.div className="row" style={{ gap: 6, flexWrap: 'wrap' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
          {promo && (
            <span className="badge good">
              <Icon name="trophy" size={12} /> Top {promo.place} advances to {promo.name}
            </span>
          )}
          <span className="badge">Bass {minIn}" minimum</span>
          {slot && <span className="badge warn">Slot {slot.minIn}-{slot.maxIn}": catch, weigh &amp; release (counts)</span>}
          {lake.lanes?.length ? <span className="badge">Run the buoyed lanes: stumps everywhere else</span> : null}
        </m.div>

        <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <Scorebug
            items={[
              { label: 'Date', value: date, icon: 'calendar' },
              { label: 'Sky', value: c.weather, icon: SKY_ICON[c.weather] },
              { label: 'Water', value: `${c.waterTempF.toFixed(0)}°${c.tempTrendFPerDay >= 0 ? '↑' : '↓'}`, icon: 'temp' },
              { label: 'Wind', value: `${c.windMph} mph`, icon: 'wind' },
              { label: 'Baro', value: c.postFront ? 'Post-front' : c.pressureTrend, icon: 'gauge' },
              { label: 'Field', value: fmt.fieldSize, icon: 'users' },
              { label: 'Weigh-in', value: '3:00', icon: 'clock' },
            ]}
          />
        </m.div>

        <div className="row grow" style={{ alignItems: 'flex-end', minHeight: 0, gap: 16 }}>
          <m.div className="col tips" style={{ gap: 6, maxWidth: 'min(460px, 50vw)' }} {...stagger(0.7, 0.12)}>
            <m.span {...rise} className="kicker" style={{ color: 'var(--accent)' }}>
              Dock talk
            </m.span>
            {tips.map((tip) => (
              <m.div key={tip} {...rise} className="panel small" style={{ padding: '7px 12px', borderLeft: '3px solid var(--accent)' }}>
                {tip}
              </m.div>
            ))}
          </m.div>
          <div className="spacer" />
        </div>
      </div>

      <div className="thumb-zone" style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
        <m.div className="row" style={{ gap: 6, alignItems: 'center' }} {...stagger(0.9, 0.05)}>
          <m.span {...rise} className="kicker" style={{ marginRight: 2, color: 'var(--accent)' }}>
            Pro plan
          </m.span>
          <m.div {...rise}>
            <DayPlan lakeId={t.lakeId} conditions={c} deck={t.deck} compact />
          </m.div>
        </m.div>
        <Button
          variant="primary"
          size="xl"
          skew
          haptic
          onClick={() => {
            unlockAudio();
            launchDay();
          }}
        >
          <span>Blast off</span>
          <Icon name="next" />
        </Button>
      </div>

      <ProPlanSheet
        t={t}
        open={plan}
        onClose={() => setPlan(false)}
        footer={
          canRerig(t) && (
            <Button cue="open" onClick={() => setScreen('deck')}>
              Re-rig rods
            </Button>
          )
        }
      />
      <HowToFishSheet lakeId={t.lakeId} open={howTo} onClose={() => setHowTo(false)} />
    </>
  );
}
