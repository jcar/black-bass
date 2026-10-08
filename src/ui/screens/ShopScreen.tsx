import { AnimatePresence, m } from 'motion/react';
import { useRef, useState } from 'react';
import { COLORS, LURES, lureKey } from '../../data/lures';
import { RODS } from '../../data/rods';
import { assetUrl, rodIconId } from '../../game/assets';
import { buyLure, buyRod } from '../../state/career';
import { useStore } from '../../state/store';
import { LureIcon, lureImageUrl, money } from '../components';
import { Button, CountUp, Icon, IconButton, Rail, Scene, Segmented, Slug, spring } from '../kit';

type Tab = 'lures' | 'rods';
interface Flight {
  key: number;
  src: string;
  from: DOMRect;
  to: DOMRect;
}

const lureSpec = (id: string) => {
  const l = LURES[id];
  return [
    `${l.weightOz} oz`,
    l.motion === 'surface' ? 'Topwater' : l.motion === 'sinking' ? 'Bottom' : `Runs ${l.runDepthFt} ft`,
    l.weedless === 'full' ? 'Weedless' : l.weedless === 'partial' ? 'Snag-resistant' : l.treble ? 'Trebles' : 'Single hook',
    ...(l.rodPower ? [`${l.rodPower}+ rod`] : []),
    ...(l.bigFishLean ? ['Big fish'] : []),
  ];
};

/** Rocket League-style shop: one featured product large, the shelf as a rail below. */
export function ShopScreen() {
  const save = useStore((s) => s.save);
  const mutateSave = useStore((s) => s.mutateSave);
  const setScreen = useStore((s) => s.setScreen);
  const [tab, setTab] = useState<Tab>('lures');
  const [lureId, setLureId] = useState(Object.keys(LURES)[0]);
  const [colorId, setColorId] = useState(LURES[Object.keys(LURES)[0]].colors[0]);
  const [rodId, setRodId] = useState(Object.keys(RODS)[0]);
  const [flight, setFlight] = useState<Flight | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cash = save.player.cash;
  const owned = save.ownedLures.length + save.ownedRods.length;

  const fly = (src: string | null) => {
    const from = heroRef.current?.querySelector('img')?.getBoundingClientRect();
    const to = boxRef.current?.getBoundingClientRect();
    if (src && from && to) setFlight({ key: Date.now(), src, from, to });
  };

  const lure = LURES[lureId];
  const lureOwned = save.ownedLures.includes(lureKey(lureId, colorId));
  const rod = RODS[rodId];
  const rodOwned = save.ownedRods.includes(rodId);
  const heroSrc = tab === 'lures' ? lureImageUrl(lureId, colorId) : assetUrl(rodIconId(rodId));

  const buy = () => {
    mutateSave((s) => void (tab === 'lures' ? buyLure(s, lureId, colorId) : buyRod(s, rodId)));
    fly(heroSrc);
  };

  return (
    <>
      <Scene id="ui_shop" dim="heavy" />
      <div className="stage">
        <div className="topbar">
          <IconButton name="back" label="Back to marina" cue="back" onClick={() => setScreen('hub')} />
          <Slug size="lg">Tackle shop</Slug>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'lures', label: 'Lures' },
              { value: 'rods', label: 'Rods' },
            ]}
          />
          <div className="spacer" />
          <div className="scorebug">
            <div className="sb-cell" ref={boxRef}>
              <span className="sb-label">
                <Icon name="bag" size={12} />
                Tackle box
              </span>
              <m.span key={owned} className="sb-value" initial={{ scale: 1.35, color: '#ffd34d' }} animate={{ scale: 1, color: '#eef6f8' }} transition={spring}>
                {owned}
              </m.span>
            </div>
            <div className="sb-cell accent">
              <span className="sb-label">Cash</span>
              <CountUp className="sb-value" value={cash} format={(n) => money(Math.round(n))} duration={0.6} />
            </div>
          </div>
        </div>

        <div className="row grow" style={{ minHeight: 0, alignItems: 'stretch', gap: 20 }}>
          <div className="hero-art" ref={heroRef} style={{ flex: 1.1 }}>
            <AnimatePresence mode="popLayout">
              {heroSrc && (
                <m.img
                  key={heroSrc}
                  src={heroSrc}
                  alt=""
                  initial={{ opacity: 0, scale: 0.9, rotate: -4 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={spring}
                  style={{ height: tab === 'rods' ? 'auto' : '100%', width: tab === 'rods' ? '100%' : 'auto' }}
                />
              )}
            </AnimatePresence>
          </div>

          <m.div key={tab === 'lures' ? lureId : rodId} className="col" style={{ flex: 1.2, justifyContent: 'center', gap: 6, minWidth: 0 }} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={spring}>
            {tab === 'lures' ? (
              <>
                <span className="kicker">{lureSpec(lureId).join(' · ')}</span>
                <h1 className="shop-name">{lure.name}</h1>
                <p className="muted clamp2" style={{ maxWidth: 440 }}>
                  {lure.description}
                </p>
                <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                  {lure.colors.map((c) => {
                    const have = save.ownedLures.includes(lureKey(lureId, c));
                    return (
                      <m.button key={c} type="button" className={`tile color-tile ${c === colorId ? 'sel' : ''}`} whileTap={{ scale: 0.92 }} onClick={() => setColorId(c)} aria-label={COLORS[c].name}>
                        <LureIcon lureId={lureId} colorId={c} size={56} />
                        {have && (
                          <span className="owned">
                            <Icon name="check" size={16} />
                          </span>
                        )}
                      </m.button>
                    );
                  })}
                  <div className="spacer" />
                  <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                    <span className="display" style={{ fontSize: 17 }}>
                      {COLORS[colorId].name}
                    </span>
                    {lureOwned ? (
                      <span className="badge good">
                        <Icon name="check" size={14} /> Owned
                      </span>
                    ) : (
                      <Button variant="primary" skew haptic cue="buy" disabled={cash < lure.price} onClick={buy}>
                        <span>Buy · {money(lure.price)}</span>
                      </Button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="kicker">
                  {rod.power} power · {rod.reel === 'spinning' ? 'Spinning' : 'Casting'} · lures {rod.lureOz[0]}–{rod.lureOz[1]} oz
                </span>
                <h1 className="shop-name">{rod.name}</h1>
                <p className="muted clamp2" style={{ maxWidth: 440 }}>
                  {rod.power === 'ML' || rod.power === 'M'
                    ? 'Light enough to cast finesse baits and protect light line.'
                    : 'Backbone to throw heavy baits far and haul big fish out of cover.'}
                </p>
                <div className="row" style={{ marginTop: 4 }}>
                  <div className="spacer" />
                  {rodOwned ? (
                    <span className="badge good">
                      <Icon name="check" size={14} /> Owned
                    </span>
                  ) : (
                    <Button variant="primary" skew haptic cue="buy" disabled={cash < rod.price} onClick={buy}>
                      <span>Buy · {money(rod.price)}</span>
                    </Button>
                  )}
                </div>
              </>
            )}
          </m.div>
        </div>

        <Rail className="shelf">
          {tab === 'lures'
            ? Object.values(LURES).map((l) => {
                const n = l.colors.filter((c) => save.ownedLures.includes(lureKey(l.id, c))).length;
                return (
                  <m.button
                    key={l.id}
                    type="button"
                    className={`tile product ${l.id === lureId ? 'sel' : ''}`}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      setLureId(l.id);
                      setColorId(l.colors.find((c) => !save.ownedLures.includes(lureKey(l.id, c))) ?? l.colors[0]);
                    }}
                  >
                    <LureIcon lureId={l.id} colorId={l.colors[0]} size={60} />
                    <span className="p-name">{l.name}</span>
                    <span className="small muted num">{n === l.colors.length ? 'All owned' : money(l.price)}</span>
                  </m.button>
                );
              })
            : Object.values(RODS).map((r) => {
                const src = assetUrl(rodIconId(r.id));
                return (
                  <m.button key={r.id} type="button" className={`tile product ${r.id === rodId ? 'sel' : ''}`} style={{ width: 160 }} whileTap={{ scale: 0.95 }} onClick={() => setRodId(r.id)}>
                    {src ? <img src={src} alt="" /> : <span className="display">{r.power}</span>}
                    <span className="p-name">{r.name}</span>
                    <span className="small muted num">{save.ownedRods.includes(r.id) ? 'Owned' : money(r.price)}</span>
                  </m.button>
                );
              })}
        </Rail>
      </div>

      <AnimatePresence>
        {flight && (
          <m.img
            key={flight.key}
            src={flight.src}
            alt=""
            style={{ position: 'fixed', left: flight.from.left, top: flight.from.top, width: flight.from.width, height: flight.from.height, zIndex: 50, pointerEvents: 'none', objectFit: 'contain' }}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{
              x: flight.to.left + flight.to.width / 2 - (flight.from.left + flight.from.width / 2),
              y: flight.to.top + flight.to.height / 2 - (flight.from.top + flight.from.height / 2),
              scale: 0.12,
              opacity: 0.2,
            }}
            transition={{ duration: 0.6, ease: [0.5, 0, 0.75, 0] }}
            onAnimationComplete={() => setFlight(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
