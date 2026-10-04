import { useState } from 'react';
import { COLORS, LURES, lureKey } from '../../data/lures';
import { RODS } from '../../data/rods';
import { buyLure, buyRod } from '../../state/career';
import { useStore } from '../../state/store';
import { LureIcon, money } from '../components';

export function ShopScreen() {
  const save = useStore((s) => s.save);
  const mutateSave = useStore((s) => s.mutateSave);
  const setScreen = useStore((s) => s.setScreen);
  const toast = useStore((s) => s.toast);
  const [tab, setTab] = useState<'lures' | 'rods'>('lures');

  return (
    <div className="screen col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <button className="btn" onClick={() => setScreen('hub')}>
            ‹ Back
          </button>
          <h1>Tackle Shop</h1>
        </div>
        <strong className="big">{money(save.player.cash)}</strong>
      </div>
      <div className="row">
        <button className={`chip ${tab === 'lures' ? 'on' : ''}`} onClick={() => setTab('lures')}>
          Lures
        </button>
        <button className={`chip ${tab === 'rods' ? 'on' : ''}`} onClick={() => setTab('rods')}>
          Rods
        </button>
      </div>
      {tab === 'lures' ? (
        <div className="grid2">
          {Object.values(LURES).map((l) => (
            <div key={l.id} className="panel col">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>{l.name}</h2>
                <span className="chip">{money(l.price)}</span>
              </div>
              <div className="small muted">
                {l.weightOz} oz · {l.motion === 'surface' ? 'Topwater' : l.motion === 'sinking' ? 'Bottom' : `Runs ${l.runDepthFt} ft`} · {l.treble ? 'Trebles' : 'Single hook'}
              </div>
              <p className="small" style={{ margin: 0 }}>
                {l.description}
              </p>
              <div className="row wrap" style={{ gap: 6 }}>
                {l.colors.map((c) => {
                  const owned = save.ownedLures.includes(lureKey(l.id, c));
                  return (
                    <button
                      key={c}
                      className={`chip ${owned ? 'on' : ''}`}
                      disabled={owned || save.player.cash < l.price}
                      onClick={() =>
                        mutateSave((s) => {
                          if (buyLure(s, l.id, c)) toast(`Bought ${l.name} (${COLORS[c].name})`, 'good');
                        })
                      }
                    >
                      <LureIcon lureId={l.id} colorId={c} size={18} />
                      {COLORS[c].name}
                      {owned ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid2">
          {Object.values(RODS).map((r) => {
            const owned = save.ownedRods.includes(r.id);
            return (
              <div key={r.id} className="panel col">
                <h2>{r.name}</h2>
                <div className="small muted">
                  {r.power} power · {r.reel} · lures {r.lureOz[0]}-{r.lureOz[1]} oz
                </div>
                <p className="small" style={{ margin: 0 }}>
                  Heavier rods cast heavy lures farther and haul big fish out of cover; light rods cast finesse baits and protect light line.
                </p>
                <button
                  className={`btn ${owned ? '' : 'primary'}`}
                  disabled={owned || save.player.cash < r.price}
                  onClick={() =>
                    mutateSave((s) => {
                      if (buyRod(s, r.id)) toast(`Bought ${r.name}`, 'good');
                    })
                  }
                >
                  {owned ? 'Owned' : `Buy ${money(r.price)}`}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
