import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import { preloadUi, setSoundEnabled } from './audio/sound';
import { loadAssetIndex } from './game/assets';
import { useStore } from './state/store';
import { App } from './ui/App';
import { MotionProvider } from './ui/kit';
import './ui/styles.css';

registerSW({ immediate: true });

// Dev-only hook for scripted playtesting (stripped from production builds).
if (import.meta.env.DEV) Object.assign(window, { __bb: { useStore } });

// iOS Safari ignores user-scalable=no; block pinch and double-tap zoom and long-press menus.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Respect the saved sound setting from the first screen, not only once a game starts.
setSoundEnabled(useStore.getState().save.settings.sound);

void loadAssetIndex().finally(() => {
  preloadUi();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MotionProvider>
        <App />
      </MotionProvider>
    </StrictMode>,
  );
});
