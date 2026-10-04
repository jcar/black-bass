import { useEffect, useRef } from 'react';
import { setSoundEnabled } from '../../audio/sound';
import { GameRunner } from '../../game/runner';
import { useStore } from '../../state/store';
import { Hud } from './Hud';
import { LandedModal } from './LandedModal';
import { TouchControls } from './TouchControls';

function PauseMenu() {
  const save = useStore((s) => s.save);
  const setPaused = useStore((s) => s.setPaused);
  const mutateSave = useStore((s) => s.mutateSave);
  const setScreen = useStore((s) => s.setScreen);
  const toggle = (k: 'sound' | 'leftHanded' | 'debugMeter') =>
    mutateSave((s) => {
      s.settings[k] = !s.settings[k];
      if (k === 'sound') setSoundEnabled(s.settings.sound);
    });
  return (
    <div className="modal-back">
      <div className="modal col" style={{ gap: 12, width: 'min(420px, 92vw)' }}>
        <h1>Paused</h1>
        <label className="row">
          <input type="checkbox" checked={save.settings.sound} onChange={() => toggle('sound')} /> Sound
        </label>
        <label className="row">
          <input type="checkbox" checked={save.settings.leftHanded} onChange={() => toggle('leftHanded')} /> Left-handed controls
        </label>
        <label className="row">
          <input type="checkbox" checked={save.settings.debugMeter} onChange={() => toggle('debugMeter')} /> Show attraction meter
        </label>
        <button className="btn primary" onClick={() => setPaused(false)}>
          Resume
        </button>
        <button
          className="btn"
          onClick={() => {
            useStore.getState().persist();
            useStore.setState({ save: { ...useStore.getState().save, activeTournament: useStore.getState().tournament ?? undefined } });
            setScreen('hub');
          }}
        >
          Save &amp; quit to hub
        </button>
      </div>
    </div>
  );
}

export function GameScreen() {
  const host = useRef<HTMLDivElement>(null);
  const hud = useStore((s) => s.hud);
  const paused = useStore((s) => s.paused);
  const settings = useStore((s) => s.save.settings);
  const toasts = useStore((s) => s.toasts);

  useEffect(() => {
    const runner = new GameRunner();
    if (host.current) void runner.start(host.current);
    setSoundEnabled(useStore.getState().save.settings.sound);
    return () => runner.stop();
  }, []);

  return (
    <div className="game-root">
      <div className="canvas-host" ref={host} />
      {hud && (
        <>
          {hud.phase !== 'Landed' && !paused && <TouchControls hud={hud} leftHanded={settings.leftHanded} />}
          <Hud hud={hud} debug={settings.debugMeter} />
          {hud.phase === 'Landed' && hud.lastLanded && <LandedModal fish={hud.lastLanded} livewell={hud.livewell} pending={hud.pendingCull} />}
        </>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
      {paused && <PauseMenu />}
    </div>
  );
}
