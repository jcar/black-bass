import { m } from 'motion/react';
import { useEffect, useState } from 'react';
import { playUi } from '../../audio/sound';
import { SPECIES } from '../../data/species';
import { TUNING } from '../../data/tuning';
import { LAKES } from '../../data/lakes';
import { catchVerdict, countsToBag, healthOf, isCwir, isDead, keeperMinIn } from '../../sim/livewell';
import type { CaughtFish } from '../../sim/types';
import { useStore } from '../../state/store';
import { FishArt, lbOz } from '../components';
import { Button, CountUp, Icon, Slug, spring } from '../kit';
import { assetUrl, portraitId } from '../../game/assets';

function Thumb({ f }: { f: CaughtFish }) {
  const url = assetUrl(portraitId(f.species, f.weightLb));
  return (
    <div className={`fish-thumb ${healthOf(f) === 'lively' ? '' : healthOf(f)}`} style={{ height: 52 }} title={healthOf(f)}>
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
  // The saved best only updates at the weigh-in, so it must also beat today's earlier fish. The
  // tournament's big fish already includes this one: a PB is this fish being the biggest so far.
  const tourneyBig = useStore((s) => s.tournament?.stats.bigFishLb ?? 0);
  const lake = useStore((s) => (s.tournament ? LAKES[s.tournament.lakeId] : undefined));
  const all = pending ? [...livewell, pending] : [];
  // Dead fish can't be culled: the suggestion is the smallest live fish.
  const smallest = all.reduce((mi, f, i) => (!isDead(f) && (mi < 0 || f.weightLb < all[mi].weightLb) ? i : mi), -1);
  const [release, setRelease] = useState(Math.max(0, smallest));
  const sp = SPECIES[fish.species];
  const verdict = catchVerdict(fish, lake);
  // A legal fish released under the one-big-fish rule still reads as a keeper-size fish, but it went back.
  const keeper = verdict === 'keeper' && fish.released !== 'bigFish';
  // Catch-weigh-immediate-release (Lake Fork): the judge weighs every legal bass, slot fish included.
  const cwir = isCwir(lake) && (fish.cwr || fish.stage);
  const counts = countsToBag(fish, lake) && !fish.released;
  // Under CWIR the card keeps the best five on its own: did this one make it?
  const onCard = livewell.some((f) => f.fishId === fish.fishId);
  const pb = counts && fish.weightLb > bigFishPb && fish.weightLb >= tourneyBig;
  // Texas Parks & Wildlife's ShareLunker program: 13 lb and up.
  const lunker = counts && fish.species === 'largemouth' && fish.weightLb >= 13;

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
          <Slug tone={keeper ? 'good' : verdict === 'slot' || fish.released ? 'gold' : 'red'} size="lg">
            {keeper ? 'Keeper' : verdict === 'slot' ? 'Slot fish' : fish.released === 'bigFish' ? 'Over the limit' : verdict === 'short' ? 'Short fish' : 'Bycatch'}
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
          {cwir ? (
            <span className="badge good">{fish.stage ? 'Weighed by your judge · kept for the stage' : verdict === 'slot' ? 'Slot fish — weighed and released' : 'Weighed by your judge · released'}</span>
          ) : (
            verdict === 'slot' && <span className="badge warn">Protected slot · released</span>
          )}
          {(pb || lunker) && (
            <m.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring, delay: 1.3 }}>
              <Slug tone="gold">{lunker ? 'ShareLunker class' : 'Personal best'}</Slug>
            </m.span>
          )}
        </div>
        {cwir && (
          <p className="small muted">
            {verdict === 'slot' && lake?.regs?.slot ? `Texas protects ${lake.regs.slot.minIn}-${lake.regs.slot.maxIn}" largemouth: it can't be kept, but your judge weighed it in the boat and it counts. ` : ''}
            {fish.stage
              ? `Your one ${lake?.regs?.bigFish?.minIn ?? 24}"+ fish rides in the livewell to the weigh-in stage: keep it alive.`
              : onCard
                ? 'Back in the lake already. It is on your card: your best five count.'
                : "Back in the lake already. Your best five are heavier, so it doesn't count."}
          </p>
        )}
        {!cwir && verdict === 'slot' && lake?.regs?.slot && (
          <p className="small muted">
            Texas law protects {lake.regs.slot.minIn}-{lake.regs.slot.maxIn}" largemouth here: it goes straight back, never into the livewell, and it doesn't count. Keep fish under {lake.regs.slot.minIn}" and one {lake.regs.slot.maxIn}" or longer.
          </p>
        )}
        {fish.released === 'bigFish' && lake?.regs?.bigFish && (
          <p className="small muted">
            Only {lake.regs.bigFish.perDay} bass {lake.regs.bigFish.minIn}" or longer may be kept a day, and you already have a bigger one. Back it goes.
          </p>
        )}
        {(verdict === 'short' || verdict === 'bycatch') && (
          <p className="small" style={{ color: '#ff8a7d' }}>
            {verdict === 'short' ? `Under the ${keeperMinIn(lake)}" minimum: back in the lake.` : `Only bass count. Unhooking cost ${TUNING.clock.unhookBycatchMin} minutes.`}
          </p>
        )}

        {pending ? (
          <>
            <span className="kicker" style={{ color: 'var(--accent)' }}>
              Livewell full · choose one to release{all.some(isDead) ? ' · dead fish must be weighed' : ''}
            </span>
            <div className="cull-tray">
              {all.map((f, i) => (
                <m.button
                  key={i}
                  type="button"
                  className={`tile ${release === i ? 'release' : ''}`}
                  whileTap={isDead(f) ? undefined : { scale: 0.94 }}
                  disabled={isDead(f)}
                  aria-label={isDead(f) ? `${lbOz(f.weightLb)} lb, dead: can't be culled` : `Release ${lbOz(f.weightLb)} lb${healthOf(f) === 'sluggish' ? ' (sluggish)' : ''}`}
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
