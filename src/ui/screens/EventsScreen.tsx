import { m } from 'motion/react';
import { useState } from 'react';
import { LAKE_LADDER, PURSE, TIER_FORMAT } from '../../data/lakes';
import { assetUrl, plateId } from '../../game/assets';
import { PROMOTE_TOP } from '../../state/career';
import { lakeName, useStore } from '../../state/store';
import { money } from '../components';
import { Button, ConfirmSheet, Icon, IconButton, Scene, Scorebug, Slug, spring, stagger, rise } from '../kit';
import { playUi } from '../../audio/sound';

const TIER_NAME = { Amateur: 'Co-Angler Series', SemiPro: 'Semi-Pro Series', Pro: 'Pro Series', Elite: 'Elite Series' } as const;

/** Forza-style event cards: art first, the numbers that matter big, locked events still visible. */
export function EventsScreen() {
  const save = useStore((s) => s.save);
  const selected = useStore((s) => s.selectedLake);
  const selectLake = useStore((s) => s.selectLake);
  const setScreen = useStore((s) => s.setScreen);
  const start = useStore((s) => s.startTournament);
  const resume = useStore((s) => s.resumeTournament);
  const [withdraw, setWithdraw] = useState(false);
  const active = save.activeTournament;
  const sel = LAKE_LADDER.find((l) => l.id === selected)!;
  const purse = PURSE[sel.tier];
  const fmt = TIER_FORMAT[sel.tier];
  const short = save.player.cash < purse.entry;

  return (
    <>
      <Scene id={plateId(sel.available ? sel.id : 'champlain', 'Overcast', 'none')} dim="full" />
      <div className="stage">
        <div className="topbar">
          <IconButton name="back" label="Back to marina" cue="back" onClick={() => setScreen('hub')} />
          <Slug size="lg">Tour schedule</Slug>
          <div className="spacer" />
          <Scorebug items={[{ label: 'Cash', value: money(save.player.cash) }]} />
        </div>

        <m.div className="event-row" {...stagger(0.05, 0.06)}>
          {LAKE_LADDER.map((l, i) => {
            const unlocked = save.unlockedLakes.includes(l.id);
            const playable = unlocked && l.available;
            const art = l.available ? assetUrl(plateId(l.id, 'Bluebird', 'none')) : null;
            const isSel = selected === l.id;
            return (
              <m.div key={l.id} {...rise} style={{ flex: 1, minWidth: 0, display: 'flex' }}>
              <m.button
                type="button"
                className={`tile event-card ${isSel ? 'sel' : ''} ${art ? '' : 'locked'}`}
                style={art ? { backgroundImage: `url(${art})` } : undefined}
                whileTap={playable ? { scale: 0.97 } : undefined}
                animate={{ y: isSel ? -6 : 0 }}
                transition={spring}
                disabled={!playable}
                onClick={() => {
                  playUi('tap');
                  selectLake(l.id);
                }}
              >
                {!playable && (
                  <span className="lock">
                    <Icon name="lock" />
                  </span>
                )}
                <span className="kicker" style={{ color: isSel ? 'var(--accent)' : undefined }}>
                  Stop {i + 1} · {l.region}
                </span>
                <span className="display" style={{ fontSize: 'clamp(20px, 2.8vw, 30px)', marginTop: 2 }}>
                  {l.name}
                </span>
                <span className="small muted" style={{ marginTop: 6 }}>
                  {!l.available ? 'Coming soon' : !unlocked ? `Finish top ${PROMOTE_TOP} at ${LAKE_LADDER[i - 1]?.name ?? 'the previous stop'}` : TIER_NAME[l.tier]}
                </span>
              </m.button>
              </m.div>
            );
          })}
        </m.div>

        <div className="row" style={{ alignItems: 'flex-end', minHeight: 64 }}>
          <Scorebug
            items={[
              { label: 'Entry', value: money(purse.entry), icon: 'bag' },
              { label: '1st place', value: money(purse.payouts[0]), icon: 'trophy', accent: true },
              { label: 'Field', value: fmt.fieldSize, icon: 'users' },
              { label: 'Format', value: fmt.days === 1 ? '1 day' : `${fmt.days} days${fmt.cutAfterDay ? ' · cut' : ''}` },
            ]}
          />
          <div className="spacer" />
          {active ? (
            <>
              <Button variant="danger" onClick={() => setWithdraw(true)}>
                Withdraw
              </Button>
              <Button variant="primary" size="lg" skew haptic onClick={resume}>
                <span>Resume {lakeName(active.lakeId)}</span>
                <Icon name="next" />
              </Button>
            </>
          ) : (
            <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
              {short && <span className="badge bad">Not enough cash for the entry fee</span>}
              <Button variant="primary" size="lg" skew haptic disabled={short || !sel.available} onClick={() => start()}>
                <span>Enter · {money(purse.entry)}</span>
                <Icon name="next" />
              </Button>
            </div>
          )}
        </div>
      </div>
      <ConfirmSheet
        open={withdraw}
        title="Withdraw"
        body={`Withdraw from ${active ? lakeName(active.lakeId) : 'this event'}? Your entry fee is lost.`}
        confirmLabel="Withdraw"
        danger
        onConfirm={() => {
          setWithdraw(false);
          useStore.getState().abandonTournament();
        }}
        onClose={() => setWithdraw(false)}
      />
    </>
  );
}
