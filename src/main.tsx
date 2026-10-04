import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { loadAssetIndex } from './game/assets';
import { App } from './ui/App';
import './ui/styles.css';

registerSW({ immediate: true });

// Dev-only hook for scripted playtesting (stripped from production builds).
if (import.meta.env.DEV) void import('./state/store').then(({ useStore }) => Object.assign(window, { __bb: { useStore } }));

// iOS Safari ignores user-scalable=no; block pinch and double-tap zoom explicitly.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

void loadAssetIndex().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
