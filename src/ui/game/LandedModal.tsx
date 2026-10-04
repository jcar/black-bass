import { useState } from 'react';
import { SPECIES } from '../../data/species';
import { TUNING } from '../../data/tuning';
import { isKeeper } from '../../sim/livewell';
import type { CaughtFish } from '../../sim/types';
import { useStore } from '../../state/store';
import { FishArt, lbOz } from '../components';

/** The catch card. When the livewell is full it doubles as the cull dialog. */
export function LandedModal({ fish, livewell, pending }: { fish: CaughtFish; livewell: CaughtFish[]; pending: CaughtFish | null }) {
  const cull = useStore((s) => s.cull);
  const cont = useStore((s) => s.continueFishing);
  const all = pending ? [...livewell, pending] : [];
  const smallest = all.reduce((m, f, i) => (f.weightLb < all[m].weightLb ? i : m), 0);
  const [release, setRelease] = useState(smallest);
  const sp = SPECIES[fish.species];
  const keeper = isKeeper(fish);

  return (
    <div className="modal-back">
      <div className="modal col" style={{ gap: 14 }}>
        <div className="catch-card">
          <div className="portrait">
            <FishArt species={fish.species} weightLb={fish.weightLb} />
          </div>
          <div className="col" style={{ gap: 6 }}>
            <h3>{keeper ? 'Keeper!' : sp.isBass ? 'Short fish' : 'Bycatch'}</h3>
            <h1>{sp.name}</h1>
            <div className="big">{lbOz(fish.weightLb)} lb</div>
            <div className="muted">{fish.lengthIn}" long</div>
            {!keeper && (
              <div className="small" style={{ color: 'var(--bad)' }}>
                {sp.isBass
                  ? `Under the ${TUNING.population.keeperMinIn}" minimum: back in the lake.`
                  : `Only bass count. Unhooking cost ${TUNING.clock.unhookBycatchMin} minutes.`}
              </div>
            )}
          </div>
        </div>
        {pending ? (
          <>
            <h3>Livewell full: pick one fish to release</h3>
            <div className="cull-list">
              {all.map((f, i) => (
                <button key={i} className={`cull-fish ${release === i ? 'sel' : ''} ${i === all.length - 1 ? 'new' : ''}`} onClick={() => setRelease(i)}>
                  {lbOz(f.weightLb)}
                  <div className="small muted">
                    {SPECIES[f.species].name.split(' ')[0]}
                    {i === all.length - 1 ? ' (new)' : ''}
                  </div>
                </button>
              ))}
            </div>
            <button className="btn primary" onClick={() => cull(release)}>
              Release {lbOz(all[release].weightLb)} and keep fishing
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={cont}>
            Keep fishing
          </button>
        )}
      </div>
    </div>
  );
}
