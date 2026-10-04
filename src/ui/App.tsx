import { useEffect } from 'react';
import { playMusic } from '../audio/sound';
import { useStore } from '../state/store';
import { GameScreen } from './game/GameScreen';
import { BriefingScreen } from './screens/BriefingScreen';
import { DeckScreen } from './screens/DeckScreen';
import { HubScreen } from './screens/HubScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { ShopScreen } from './screens/ShopScreen';
import { TitleScreen } from './screens/TitleScreen';

function RotatePrompt() {
  return (
    <div className="rotate">
      <div className="col" style={{ alignItems: 'center' }}>
        <div style={{ fontSize: 56 }}>↻</div>
        <h2>Rotate to landscape</h2>
        <p className="muted">Black Bass is played sideways, like holding a rod.</p>
      </div>
    </div>
  );
}

export function App() {
  const screen = useStore((s) => s.screen);
  const toasts = useStore((s) => s.toasts);
  // Generated music (if the pipeline produced it): menu, on-the-water, weigh-in.
  const track = screen === 'game' ? 'fishing' : screen === 'results' ? 'weighin' : 'menu';
  useEffect(() => playMusic(track), [track]);
  return (
    <>
      {screen === 'title' && <TitleScreen />}
      {screen === 'hub' && <HubScreen />}
      {screen === 'shop' && <ShopScreen />}
      {screen === 'deck' && <DeckScreen />}
      {screen === 'briefing' && <BriefingScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'results' && <ResultsScreen />}
      {screen !== 'game' && (
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tone}`}>
              {t.text}
            </div>
          ))}
        </div>
      )}
      <RotatePrompt />
    </>
  );
}
