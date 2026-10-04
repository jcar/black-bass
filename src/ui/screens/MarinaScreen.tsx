import { m } from 'motion/react';
import { useState } from 'react';
import { RANK_LABEL } from '../../state/career';
import { lakeName, useStore, type Screen } from '../../state/store';
import { lbOz, money } from '../components';
import { Button, Icon, IconButton, LowerThird, Scene, Scorebug, Slug, spring } from '../kit';
import { SettingsSheet } from '../Settings';
import { playUi } from '../../audio/sound';

/** Places in the marina art (percent of the 16:9 ui_marina image) and where they lead. */
const SPOTS: { id: string; label: string; x: number; y: number; to: Screen }[] = [
  { id: 'shop', label: 'Tackle Shop', x: 17, y: 42, to: 'shop' },
  { id: 'ramp', label: 'Tournaments', x: 46, y: 74, to: 'events' },
  { id: 'boat', label: 'Rod Locker', x: 80, y: 63, to: 'deck' },
  { id: 'trophy', label: 'Trophy Room', x: 90, y: 36, to: 'trophies' },
];

export function MarinaScreen() {
  const save = useStore((s) => s.save);
  const setScreen = useStore((s) => s.setScreen);
  const resume = useStore((s) => s.resumeTournament);
  const last = useStore((s) => s.lastResult);
  const [settings, setSettings] = useState(false);
  const active = save.activeTournament;

  return (
    <>
      <Scene id="ui_marina" dim="soft">
        {SPOTS.map((s, i) => {
          const goal = s.id === 'ramp';
          return (
            <button
              key={s.id}
              type="button"
              className={`hotspot ${goal ? 'goal' : ''}`}
              style={{ '--x': `${s.x}%`, '--y': `${s.y}%` } as React.CSSProperties}
              onClick={() => {
                playUi(goal ? 'confirm' : 'tap');
                setScreen(s.to);
              }}
            >
              {/* Motion animates the inner element: its transform would replace the CSS centring. */}
              <m.span className="hotspot-inner" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.92 }} transition={{ ...spring, delay: 0.25 + i * 0.07 }}>
                <span className="ring" />
                <Slug tone={goal ? 'accent' : 'dark'}>{s.label}</Slug>
              </m.span>
            </button>
          );
        })}
      </Scene>

      <div className="stage" style={{ pointerEvents: 'none' }}>
        <div className="topbar" style={{ pointerEvents: 'auto' }}>
          <m.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
            <Scorebug
              items={[
                { label: 'Rank', value: RANK_LABEL[save.player.rank], accent: true },
                { label: 'Cash', value: money(save.player.cash) },
                { label: 'Points', value: save.player.rankPoints },
                { label: 'Big fish', value: save.personalBests.bigFishLb ? lbOz(save.personalBests.bigFishLb) : '—' },
              ]}
            />
          </m.div>
          <div className="spacer" />
          <IconButton name="gear" label="Settings" onClick={() => setSettings(true)} />
          <IconButton name="back" label="Title screen" cue="back" onClick={() => setScreen('title')} />
        </div>

        <div className="spacer" />
        {last && (
          <div style={{ maxWidth: '58vw' }}>
            <LowerThird
              kicker={`Final · ${lakeName(last.result.lakeId)}`}
              kickerTone={last.result.place <= 3 ? 'gold' : 'accent'}
              title={
                <>
                  #{last.result.place} of {last.result.fieldSize} · {lbOz(last.result.totalLb)}
                  <span className="unit">lb</span>
                </>
              }
              sub={
                <>
                  {last.result.payout > 0 ? `Won ${money(last.result.payout)}` : 'Out of the money'} · +{last.result.points} pts
                  {last.promoted && <strong style={{ color: 'var(--good)' }}> · {last.promoted} unlocked</strong>}
                </>
              }
              delay={0.3}
            />
          </div>
        )}
      </div>

      <div className="thumb-zone">
        {active ? (
          <Button variant="primary" size="lg" skew haptic onClick={resume}>
            <span>
              Resume {lakeName(active.lakeId)} · Day {active.day}
            </span>
            <Icon name="next" />
          </Button>
        ) : (
          <Button variant="primary" size="lg" skew haptic onClick={() => setScreen('events')}>
            <span>Next event</span>
            <Icon name="next" />
          </Button>
        )}
      </div>
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </>
  );
}
