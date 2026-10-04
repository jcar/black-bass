import { m } from 'motion/react';
import { useState } from 'react';
import { COLORS, LURES } from '../../data/lures';
import { LINE_OPTIONS, lineLabel, RODS } from '../../data/rods';
import { assetUrl, rodIconId } from '../../game/assets';
import { MAX_DECK } from '../../state/career';
import { useStore } from '../../state/store';
import type { LineType, RodSetup } from '../../sim/types';
import { LureIcon } from '../components';
import { Button, Icon, IconButton, Rail, Scene, Scorebug, Segmented, Sheet, Slug, Stepper, rise, stagger } from '../kit';
import { playUi } from '../../audio/sound';

const LINE_NOTE: Record<LineType, string> = {
  fluoro: 'Nearly invisible, sinks, moderate stretch.',
  mono: 'Stretchy shock absorber: great with trebles and topwater.',
  braid: 'No stretch, very strong, visible in clear water.',
};

const mismatchOf = (d: RodSetup) => {
  const lure = LURES[d.lureId];
  const rod = RODS[d.rodId];
  return lure.weightOz < rod.lureOz[0] || lure.weightOz > rod.lureOz[1];
};

function RodArt({ rodId, height }: { rodId: string; height?: number }) {
  const src = assetUrl(rodIconId(rodId));
  return src ? <img className="rod-art" src={src} alt="" style={height ? { height } : undefined} /> : <div className="display" style={{ height: height ?? 62, display: 'grid', placeItems: 'center' }}>{RODS[rodId].power}</div>;
}

/** The boat's rod locker (DREDGE-style tray): rods as cards, rigging in a sheet. No <select>s. */
export function DeckScreen() {
  const save = useStore((s) => s.save);
  const mutateSave = useStore((s) => s.mutateSave);
  const setScreen = useStore((s) => s.setScreen);
  const [shake, setShake] = useState(0);
  const locked = !!save.activeTournament;
  const [editing, setEditing] = useState<number | null>(null);

  const update = (i: number, patch: Partial<RodSetup>) =>
    mutateSave((s) => {
      s.deck[i] = { ...s.deck[i], ...patch };
    });
  const d = editing !== null ? save.deck[editing] : null;

  return (
    <>
      <Scene id="ui_locker" dim="full" />
      <div className="stage">
        <div className="topbar">
          <IconButton name="back" label="Back to marina" cue="back" onClick={() => setScreen('hub')} />
          <Slug size="lg">Rod locker</Slug>
          <span className="small muted">Swap rods on the water with one tap.</span>
          <div className="spacer" />
          {locked && (
            <m.span key={shake} className="badge warn" initial={false} animate={shake ? { x: [0, -8, 8, -6, 6, -3, 0] } : undefined} transition={{ duration: 0.45 }}>
              <Icon name="lock" size={13} /> Locked during a tournament
            </m.span>
          )}
          <Scorebug items={[{ label: 'On deck', value: `${save.deck.length}/${MAX_DECK}` }]} />
        </div>

        <m.div className="grow" style={{ minHeight: 0, display: 'flex' }} {...stagger(0.05, 0.06)}>
          <Rail style={{ alignItems: 'stretch', width: '100%' }}>
            {save.deck.map((r, i) => (
              <m.button
                key={r.id}
                {...rise}
                type="button"
                className="tile rod-card"
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  if (locked) {
                    playUi('back');
                    return setShake((n) => n + 1);
                  }
                  playUi('open');
                  setEditing(i);
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="kicker" style={{ color: 'var(--accent)' }}>
                    Rod {i + 1}
                  </span>
                  {mismatchOf(r) && <span className="badge warn">Weight mismatch</span>}
                </div>
                <RodArt rodId={r.rodId} />
                <span className="display" style={{ fontSize: 17 }}>
                  {RODS[r.rodId].name}
                </span>
                <div className="row" style={{ gap: 10, marginTop: 'auto' }}>
                  <LureIcon lureId={r.lureId} colorId={r.colorId} size={64} />
                  <div className="col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="display" style={{ fontSize: 18 }}>
                      {LURES[r.lureId].name}
                    </span>
                    <span className="small muted">{COLORS[r.colorId].name}</span>
                    <span className="small">{lineLabel(r.line)}</span>
                  </div>
                </div>
              </m.button>
            ))}
            {save.deck.length < MAX_DECK && !locked && (
              <m.button
                {...rise}
                type="button"
                className="tile rod-card add"
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  playUi('confirm');
                  mutateSave((s) => {
                    const [lureId, colorId] = s.ownedLures[0].split(':');
                    s.deck.push({ id: `deck-${Date.now()}`, rodId: s.ownedRods[0], line: { type: 'fluoro', testLb: 10 }, lureId, colorId });
                  });
                }}
              >
                <Icon name="plus" size={34} />
                <span className="display" style={{ fontSize: 18 }}>
                  Rig another rod
                </span>
              </m.button>
            )}
          </Rail>
        </m.div>
      </div>

      <Sheet
        open={!!d}
        onClose={() => setEditing(null)}
        title={editing !== null ? `Rig rod ${editing + 1}` : ''}
        footer={
          <>
            {save.deck.length > 1 && (
              <Button
                variant="danger"
                cue="back"
                onClick={() => {
                  const i = editing!;
                  setEditing(null);
                  mutateSave((s) => void s.deck.splice(i, 1));
                }}
              >
                Remove rod
              </Button>
            )}
            <Button variant="primary" haptic onClick={() => setEditing(null)}>
              Done
            </Button>
          </>
        }
      >
        {d && editing !== null && (
          <>
            <section className="col" style={{ gap: 6 }}>
              <span className="kicker">Rod</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {save.ownedRods.map((id) => (
                  <m.button key={id} type="button" className={`tile ${d.rodId === id ? 'sel' : ''}`} style={{ width: 132, padding: 6 }} whileTap={{ scale: 0.95 }} onClick={() => (playUi('tap'), update(editing, { rodId: id }))}>
                    <RodArt rodId={id} height={36} />
                    <div className="display" style={{ fontSize: 14, marginTop: 2 }}>
                      {RODS[id].name}
                    </div>
                  </m.button>
                ))}
              </div>
            </section>

            <section className="col" style={{ gap: 6 }}>
              <span className="kicker">Lure</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {save.ownedLures.map((k) => {
                  const [l, c] = k.split(':');
                  const on = d.lureId === l && d.colorId === c;
                  return (
                    <m.button key={k} type="button" className={`tile color-tile ${on ? 'sel' : ''}`} style={{ width: 64, height: 64 }} whileTap={{ scale: 0.92 }} aria-label={`${LURES[l].name} ${COLORS[c].name}`} onClick={() => (playUi('tap'), update(editing, { lureId: l, colorId: c }))}>
                      <LureIcon lureId={l} colorId={c} size={58} />
                    </m.button>
                  );
                })}
              </div>
              <span className="small">
                <strong>{LURES[d.lureId].name}</strong> · {COLORS[d.colorId].name} · {LURES[d.lureId].weightOz} oz
              </span>
              {mismatchOf(d) && (
                <span className="badge warn" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}>
                  Outside this rod's {RODS[d.rodId].lureOz[0]}–{RODS[d.rodId].lureOz[1]} oz range: shorter casts
                </span>
              )}
            </section>

            <section className="col" style={{ gap: 8 }}>
              <span className="kicker">Line</span>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Segmented<LineType>
                  value={d.line.type}
                  onChange={(type) => update(editing, { line: { type, testLb: LINE_OPTIONS[type][Math.floor(LINE_OPTIONS[type].length / 2)] } })}
                  options={[
                    { value: 'fluoro', label: 'Fluoro' },
                    { value: 'mono', label: 'Mono' },
                    { value: 'braid', label: 'Braid' },
                  ]}
                />
                <Stepper values={LINE_OPTIONS[d.line.type]} value={d.line.testLb} onChange={(testLb) => update(editing, { line: { ...d.line, testLb } })} format={(v) => `${v} lb`} />
              </div>
              <span className="small muted">{LINE_NOTE[d.line.type]}</span>
            </section>
          </>
        )}
      </Sheet>
    </>
  );
}
