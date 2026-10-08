import { AnimatePresence } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { setSoundEnabled } from '../../audio/sound';
import { GameRunner } from '../../game/runner';
import { adviceFor } from '../../sim/tierAdvice';
import { useStore } from '../../state/store';
import { Button, Icon } from '../kit';
import { HowToFishSheet, ProPlanSheet } from '../HelpSheets';
import { SettingsSheet } from '../Settings';
import { Hud } from './Hud';
import { LakeMap } from './LakeMap';
import { LandedModal } from './LandedModal';
import { Banner, NoticeLive } from './Notices';
import { TouchControls } from './TouchControls';

function PauseMenu({ open }: { open: boolean }) {
  const setPaused = useStore((s) => s.setPaused);
  const setScreen = useStore((s) => s.setScreen);
  const t = useStore((s) => s.tournament);
  const [plan, setPlan] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const resume = () => {
    setPlan(false);
    setHowTo(false);
    setPaused(false);
  };
  return (
    <>
      <SettingsSheet open={open} onClose={resume}>
        <div className="col" style={{ gap: 10, marginTop: 'auto' }}>
          {t && (
            <div className="row" style={{ gap: 8 }}>
              <Button cue="open" onClick={() => setPlan(true)}>
                <Icon name="fish" /> Pro plan
              </Button>
              <Button cue="open" onClick={() => setHowTo(true)}>
                <Icon name="info" /> How to fish
              </Button>
            </div>
          )}
          <Button variant="primary" size="lg" skew haptic onClick={resume}>
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
      {/* Opened from the pause menu, so they stack on top of it (Escape closes the top one first). */}
      {t && <ProPlanSheet t={t} open={open && plan} onClose={() => setPlan(false)} />}
      {t && <HowToFishSheet lakeId={t.lakeId} open={open && howTo} onClose={() => setHowTo(false)} />}
    </>
  );
}

export function GameScreen() {
  const host = useRef<HTMLDivElement>(null);
  const hud = useStore((s) => s.hud);
  const paused = useStore((s) => s.paused);
  const mapOpen = useStore((s) => s.mapOpen);
  const settings = useStore((s) => s.save.settings);
  const lureId = useStore((s) => s.tournament?.deck[s.hud?.activeRod ?? 0]?.lureId ?? 'ned');
  const tier = useStore((s) => s.tournament?.tier);
  const dataMin = tier ? adviceFor(tier).pointDataMin : null;

  useEffect(() => {
    const runner = new GameRunner();
    if (host.current) void runner.start(host.current);
    setSoundEnabled(useStore.getState().save.settings.sound);
    useStore.getState().setMapOpen(false);
    return () => {
      runner.stop();
      useStore.getState().setMapOpen(false);
    };
  }, []);

  useEffect(() => {
    // Escape pauses. An open sheet takes Escape first (kit Sheet, capture phase) and the event never
    // gets here, so one press never both closes the pause menu and reopens it.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      const st = useStore.getState();
      // M opens the lake map while driving (M is move/burn in only once you're fishing) and closes it.
      if (e.key.toLowerCase() === 'm' && !st.paused && (st.mapOpen || st.hud?.phase === 'Navigate')) st.setMapOpen(!st.mapOpen);
      // I re-checks the data for this point (between casts, where the tier allows it).
      if (e.key.toLowerCase() === 'i' && !st.paused && !st.mapOpen && st.hud?.phase === 'Cast' && !st.hud.castCharging && !st.hud.castFlying) st.checkPoint(true);
      if (e.key !== 'Escape') return;
      if (!st.paused) st.setPaused(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="game-root">
      <div className="canvas-host" ref={host} />
      {hud && (
        <>
          {hud.phase !== 'Landed' && !paused && !mapOpen && (
            <TouchControls
              phase={hud.phase}
              canFish={hud.canFish}
              inRange={hud.inRange}
              castFlying={hud.castFlying}
              castCharging={hud.castCharging}
              tension={Math.round(hud.tension * 50) / 50}
              leftHanded={settings.leftHanded}
              lureId={lureId}
              dataMin={dataMin}
              hook={hud.hook}
              checkIn={hud.checkIn.can ? (hud.checkIn.headIn ? 'due' : 'open') : 'none'}
            />
          )}
          <Hud hud={hud} debug={settings.debugMeter} />
          <AnimatePresence>{hud.phase === 'Landed' && hud.lastLanded && <LandedModal key={hud.lastLanded.weightLb} fish={hud.lastLanded} livewell={hud.livewell} pending={hud.pendingCull} />}</AnimatePresence>
        </>
      )}
      <Banner />
      <NoticeLive />
      <LakeMap />
      <PauseMenu open={paused} />
    </div>
  );
}
