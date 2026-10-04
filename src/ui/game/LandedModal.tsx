import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import { playUi } from '../../audio/sound';
import { SPECIES } from '../../data/species';
import { TUNING } from '../../data/tuning';
import { LAKES } from '../../data/lakes';
import { isKeeper, keeperMinIn } from '../../sim/livewell';
import type { CaughtFish } from '../../sim/types';
import { useStore } from '../../state/store';
import { FishArt, lbOz } from '../components';
import { Button, CountUp, Icon, Slug, spring } from '../kit';
import { assetUrl, portraitId } from '../../game/assets';

function Thumb({ f }: { f: CaughtFish }) {
  const url = assetUrl(portraitId(f.species, f.weightLb));
  return (
    <div className="fish-thumb" style={{ height: 52 }}>
      {url && <img src={url} alt="" />}
      <span className="fw">{lbOz(f.weightLb)}</span>
    </div>
  );
}

/** The catch reveal. When the livewell is full it doubles as the cull tray. */
export function LandedModal({ fish, livewell, pending }: { fish: CaughtFish; livewell: CaughtFish[]; pending: CaughtFish | null }) {
  const cull = useStore((s) => s.cull);
  const cont = useStore((s) => s.continueFishing);
  const bigFishPb = useStore((s) => s.save.personalBests.bigFishLb);
  const lake = useStore((s) => (s.tournament ? LAKES[s.tournament.lakeId] : undefined));
  const all = pending ? [...livewell, pending] : [];
  const smallest = all.reduce((mi, f, i) => (f.weightLb < all[mi].weightLb ? i : mi), 0);
  const [release, setRelease] = useState(smallest);
  const sp = SPECIES[fish.species];
  const keeper = isKeeper(fish, lake);
  const pb = keeper && fish.weightLb > bigFishPb;
  // Texas Parks & Wildlife's ShareLunker program: 13 lb and up.
  const lunker = keeper && fish.species === 'largemouth' && fish.weightLb >= 13;

  useEffect(() => {
    if (pb || lunker) setTimeout(() => playUi(lunker ? 'promote' : 'record'), 1300);
  }, [pb, lunker]);

  return (
    <m.div className="catch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <m.div className="catch-art" initial={{ x: '-12%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
        <m.div style={{ position: 'absolute', inset: 0 }} initial={{ scale: 1.12 }} animate={{ scale: 1 }} transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}>
          <FishArt species={fish.species} weightLb={fish.weightLb} />
        </m.div>
      </m.div>
      <div className="catch-info">
        <m.div className="stamp" initial={{ scale: 1.6, opacity: 0, rotate: -6 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ ...spring, delay: 0.25 }}>
          <Slug tone={keeper ? 'good' : 'red'} size="lg">
            {keeper ? 'Keeper' : sp.isBass ? 'Short fish' : 'Bycatch'}
          </Slug>
        </m.div>
        <m.h1 initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: 0.15 }}>
          {sp.name}
        </m.h1>
        <div className="catch-weight">
          <CountUp value={fish.weightLb} from={0} format={lbOz} duration={0.7} delay={0.2} settle />
          <span className="unit">lb</span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="badge">{fish.lengthIn}" long</span>
          {fish.cwr && <span className="badge warn">Slot fish · weighed &amp; released</span>}
          {(pb || lunker) && (
            <m.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring, delay: 1.3 }}>
              <Slug tone="gold">{lunker ? 'ShareLunker class' : 'Personal best'}</Slug>
            </m.span>
          )}
        </div>
        {fish.cwr && <p className="small muted">A marshal weighs it in the boat and it goes straight back: it still counts toward your bag.</p>}
        {!keeper && (
          <p className="small" style={{ color: '#ff8a7d' }}>
            {sp.isBass ? `Under the ${keeperMinIn(lake)}" minimum: back in the lake.` : `Only bass count. Unhooking cost ${TUNING.clock.unhookBycatchMin} minutes.`}
          </p>
        )}

        {pending ? (
          <>
            <span className="kicker" style={{ color: 'var(--accent)' }}>
              Livewell full · choose one to release
            </span>
            <div className="cull-tray">
              {all.map((f, i) => (
                <m.button
                  key={i}
                  type="button"
                  className={`tile ${release === i ? 'release' : ''}`}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => {
                    playUi('tap');
                    setRelease(i);
                  }}
                >
                  <Thumb f={f} />
                  {release === i && (
                    <span className="tag">
                      <Slug tone="red">Release</Slug>
                    </span>
                  )}
                  {i === all.length - 1 && release !== i && (
                    <span className="tag">
                      <Slug>New</Slug>
                    </span>
                  )}
                </m.button>
              ))}
            </div>
            <Button variant="primary" size="lg" skew haptic onClick={() => cull(release)} style={{ alignSelf: 'flex-start' }}>
              <span>Release {lbOz(all[release].weightLb)} · keep fishing</span>
              <Icon name="next" />
            </Button>
          </>
        ) : (
          <Button variant="primary" size="lg" skew haptic onClick={cont} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
            <span>Keep fishing</span>
            <Icon name="next" />
          </Button>
        )}
      </div>
    </m.div>
  );
}
