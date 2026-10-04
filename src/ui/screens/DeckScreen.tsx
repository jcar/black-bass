import { COLORS, LURES } from '../../data/lures';
import { LINE_OPTIONS, RODS } from '../../data/rods';
import { MAX_DECK } from '../../state/career';
import { useStore } from '../../state/store';
import type { LineType, RodSetup } from '../../sim/types';
import { LureIcon } from '../components';

export function DeckScreen() {
  const save = useStore((s) => s.save);
  const mutateSave = useStore((s) => s.mutateSave);
  const setScreen = useStore((s) => s.setScreen);
  const locked = !!save.activeTournament;

  const update = (i: number, patch: Partial<RodSetup>) =>
    mutateSave((s) => {
      s.deck[i] = { ...s.deck[i], ...patch };
    });

  return (
    <div className="screen col" style={{ gap: 14 }}>
      <div className="row">
        <button className="btn" onClick={() => setScreen('hub')}>
          ‹ Back
        </button>
        <h1>Rod Deck</h1>
        <span className="muted small">Rig up to {MAX_DECK} rods. Swap between them on the water with one tap.</span>
      </div>
      {locked && <div className="panel small">Your deck is locked while a tournament is in progress.</div>}
      <div className="grid2">
        {save.deck.map((d, i) => {
          const lure = LURES[d.lureId];
          const rod = RODS[d.rodId];
          const mismatch = lure.weightOz < rod.lureOz[0] || lure.weightOz > rod.lureOz[1];
          return (
            <div key={d.id} className="panel col">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row">
                  <LureIcon lureId={d.lureId} colorId={d.colorId} />
                  <h2>Rod {i + 1}</h2>
                </div>
                {save.deck.length > 1 && !locked && (
                  <button className="chip" onClick={() => mutateSave((s) => void s.deck.splice(i, 1))}>
                    Remove
                  </button>
                )}
              </div>
              <label className="col small">
                Rod
                <select disabled={locked} value={d.rodId} onChange={(e) => update(i, { rodId: e.target.value })}>
                  {save.ownedRods.map((r) => (
                    <option key={r} value={r}>
                      {RODS[r].name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <label className="col small grow">
                  Line
                  <select
                    disabled={locked}
                    value={d.line.type}
                    onChange={(e) => {
                      const type = e.target.value as LineType;
                      update(i, { line: { type, testLb: LINE_OPTIONS[type][Math.floor(LINE_OPTIONS[type].length / 2)] } });
                    }}
                  >
                    <option value="fluoro">Fluorocarbon</option>
                    <option value="mono">Monofilament</option>
                    <option value="braid">Braid</option>
                  </select>
                </label>
                <label className="col small grow">
                  Test
                  <select disabled={locked} value={d.line.testLb} onChange={(e) => update(i, { line: { ...d.line, testLb: Number(e.target.value) } })}>
                    {LINE_OPTIONS[d.line.type].map((lb) => (
                      <option key={lb} value={lb}>
                        {lb} lb
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="col small">
                Lure
                <select
                  disabled={locked}
                  value={`${d.lureId}:${d.colorId}`}
                  onChange={(e) => {
                    const [lureId, colorId] = e.target.value.split(':');
                    update(i, { lureId, colorId });
                  }}
                >
                  {save.ownedLures.map((k) => {
                    const [l, c] = k.split(':');
                    return (
                      <option key={k} value={k}>
                        {LURES[l].name}: {COLORS[c].name}
                      </option>
                    );
                  })}
                </select>
              </label>
              {mismatch && (
                <span className="small" style={{ color: 'var(--accent)' }}>
                  A {lure.weightOz} oz lure is outside this rod's {rod.lureOz[0]}-{rod.lureOz[1]} oz range: casts will be shorter.
                </span>
              )}
              <span className="small muted">
                {d.line.type === 'braid'
                  ? 'Braid: no stretch, very strong, visible in clear water.'
                  : d.line.type === 'mono'
                    ? 'Mono: stretchy shock absorber, great with treble hooks and topwater.'
                    : 'Fluoro: nearly invisible, sinks, moderate stretch.'}
              </span>
            </div>
          );
        })}
      </div>
      {save.deck.length < MAX_DECK && !locked && (
        <button
          className="btn"
          onClick={() =>
            mutateSave((s) => {
              const [lureId, colorId] = s.ownedLures[0].split(':');
              s.deck.push({ id: `deck-${Date.now()}`, rodId: s.ownedRods[0], line: { type: 'fluoro', testLb: 10 }, lureId, colorId });
            })
          }
        >
          + Add rod
        </button>
      )}
    </div>
  );
}
