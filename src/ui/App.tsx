import { AnimatePresence, m } from 'motion/react';
import { useEffect, useState } from 'react';
import { playMusic } from '../audio/sound';
import { useStore, type Screen } from '../state/store';
import { GameScreen } from './game/GameScreen';
import { Icon } from './kit';
import { BriefingScreen } from './screens/BriefingScreen';
import { DeckScreen } from './screens/DeckScreen';
import { EventsScreen } from './screens/EventsScreen';
import { MarinaScreen } from './screens/MarinaScreen';
import { ShopScreen } from './screens/ShopScreen';
import { TitleScreen } from './screens/TitleScreen';
import { TrophyScreen } from './screens/TrophyScreen';
import { WeighInScreen } from './screens/WeighInScreen';

const SCREENS: Record<Screen, () => React.ReactNode> = {
  title: TitleScreen,
  hub: MarinaScreen,
  events: EventsScreen,
  trophies: TrophyScreen,
  shop: ShopScreen,
  deck: DeckScreen,
  briefing: BriefingScreen,
  game: GameScreen,
  results: WeighInScreen,
};

/** Changes of context (into/out of the pre-show, the water, the weigh-in) get a broadcast wipe. */
const BIG = new Set<Screen>(['briefing', 'game', 'results']);

function RotatePrompt() {
  return (
    <div className="rotate">
      <div className="col" style={{ alignItems: 'center' }}>
        <Icon name="rotate" />
        <h2>Rotate to landscape</h2>
        <p className="muted">Black Bass is played sideways, like holding a rod.</p>
      </div>
    </div>
  );
}

function Wipe({ n }: { n: number }) {
  return (
    <AnimatePresence>
      {n > 0 && (
        <m.div
          key={n}
          className="wipe"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 0.95, ease: [0.65, 0, 0.35, 1] }}
        >
          <div className="w-accent" />
          <div className="w-band" />
          <div className="w-edge" />
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  // Generated music: menu, on-the-water, weigh-in.
  const track = screen === 'game' ? 'fishing' : screen === 'results' ? 'weighin' : 'menu';
  useEffect(() => playMusic(track), [track]);

  // Adjust-state-during-render: count big context changes to retrigger the wipe.
  const [last, setLast] = useState(screen);
  const [wipe, setWipe] = useState(0);
  if (last !== screen) {
    setLast(screen);
    if (BIG.has(screen) || BIG.has(last)) setWipe((w) => w + 1);
  }
  const big = BIG.has(screen) || BIG.has(last);
  const Content = SCREENS[screen];

  return (
    <>
      <AnimatePresence mode="wait">
        <m.div
          key={screen}
          className="screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: big ? 0.3 : 0.18, delay: big ? 0.12 : 0 }}
        >
          <Content />
        </m.div>
      </AnimatePresence>
      <Wipe n={wipe} />
      <RotatePrompt />
    </>
  );
}
