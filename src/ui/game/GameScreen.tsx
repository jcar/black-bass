import { AnimatePresence } from 'motion/react';
import { useEffect, useRef } from 'react';
import { setSoundEnabled } from '../../audio/sound';
import { GameRunner } from '../../game/runner';
import { useStore } from '../../state/store';
import { Button, Icon } from '../kit';
import { SettingsSheet } from '../Settings';
import { Hud } from './Hud';
import { LandedModal } from './LandedModal';
import { Banner, NoticeLive } from './Notices';
import { TouchControls } from './TouchControls';

function PauseMenu({ open }: { open: boolean }) {
  const setPaused = useStore((s) => s.setPaused);
  const setScreen = useStore((s) => s.setScreen);
  return (
    <SettingsSheet open={open} onClose={() => setPaused(false)}>
      <div className="col" style={{ gap: 10, marginTop: 'auto' }}>
        <Button variant="primary" size="lg" skew haptic onClick={() => setPaused(false)}>
          <span>Resume</span>
          <Icon name="next" />
        </Button>
        <Button
          cue="back"
          onClick={() => {
            useStore.getState().persist();
            useStore.setState({ save: { ...useStore.getState().save, activeTournament: useStore.getState().tournament ?? undefined } });
            setScreen('hub');
          }}
        >
          Save & quit to marina
        </Button>
      </div>
    </SettingsSheet>
  );
}

export function GameScreen() {
  const host = useRef<HTMLDivElement>(null);
  const hud = useStore((s) => s.hud);
  const paused = useStore((s) => s.paused);
  const settings = useStore((s) => s.save.settings);

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
          {hud.phase !== 'Landed' && !paused && (
            <TouchControls
              phase={hud.phase}
              canFish={hud.canFish}
              castFlying={hud.castFlying}
              castCharging={hud.castCharging}
              tension={Math.round(hud.tension * 50) / 50}
              leftHanded={settings.leftHanded}
            />
          )}
          <Hud hud={hud} debug={settings.debugMeter} />
          <AnimatePresence>{hud.phase === 'Landed' && hud.lastLanded && <LandedModal key={hud.lastLanded.weightLb} fish={hud.lastLanded} livewell={hud.livewell} pending={hud.pendingCull} />}</AnimatePresence>
        </>
      )}
      <Banner />
      <NoticeLive />
      <PauseMenu open={paused} />
    </div>
  );
}
