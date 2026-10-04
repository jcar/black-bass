import { m, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { playUi, unlockAudio } from '../../audio/sound';
import { assetUrl, plateId } from '../../game/assets';
import { clearSave, newSave, writeSave } from '../../state/save';
import { lakeName, useStore } from '../../state/store';
import { Button, ConfirmSheet, Icon, IconButton, rise, stagger } from '../kit';
import { SettingsSheet } from '../Settings';
import { TitleDiorama } from './TitleDiorama';

/** "Tap to start" only once per launch: it's what unlocks audio on iOS. */
let started = false;
const installed = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function TitleScreen() {
  const save = useStore((s) => s.save);
  const setScreen = useStore((s) => s.setScreen);
  const resume = useStore((s) => s.resumeTournament);
  const reduce = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(started);
  const [confirmNew, setConfirmNew] = useState(false);
  const [settings, setSettings] = useState(false);
  const active = save.activeTournament;
  const hasCareer = save.history.length > 0 || !!active;

  useEffect(() => {
    const d = new TitleDiorama();
    if (host.current) void d.start(host.current, assetUrl(plateId('champlain', 'Bluebird', 'none')), !!reduce);
    return () => d.destroy();
  }, [reduce]);

  const start = () => {
    if (menu) return;
    unlockAudio();
    playUi('confirm');
    started = true;
    setMenu(true);
  };

  const startNew = () => {
    clearSave();
    const fresh = newSave();
    writeSave(fresh);
    useStore.setState({ save: fresh, tournament: null });
    setScreen('hub');
  };

  return (
    <>
      <div className="title-canvas" ref={host} />
      <div className="scene-dim left" />
      <div className="stage" onPointerDown={start} style={{ justifyContent: 'center' }}>
        <m.div
          className="logo"
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0, scale: menu ? 0.78 : 1, y: menu ? -10 : 0 }}
          style={{ transformOrigin: 'left center' }}
          transition={{ type: 'spring', stiffness: 220, damping: 30 }}
        >
          <span className="slug lg">
            <span>Pro Tour</span>
          </span>
          <div className="logo-word">Black Bass</div>
          <div className="logo-rule" />
        </m.div>

        {!menu ? (
          <m.div key="press" className="press-start" initial={{ opacity: 0 }} animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 2.4, repeat: Infinity, delay: 0.6 }} style={{ marginTop: 28 }}>
            Tap to start
          </m.div>
        ) : (
          <m.div key="menu" className="menu-stack" style={{ marginTop: 6 }} {...stagger(0.1, 0.07)}>
            {active && (
              <m.div {...rise}>
                <Button variant="primary" size="lg" skew haptic onClick={resume}>
                  <span>Resume · {lakeName(active.lakeId)} Day {active.day}</span>
                  <Icon name="next" />
                </Button>
              </m.div>
            )}
            <m.div {...rise}>
              <Button variant={active ? 'default' : 'primary'} size="lg" skew haptic={!active} onClick={() => setScreen('hub')}>
                <span>{hasCareer ? 'Continue career' : 'Start career'}</span>
                <Icon name="next" />
              </Button>
            </m.div>
            {hasCareer && (
              <m.div {...rise}>
                <Button skew onClick={() => setConfirmNew(true)}>
                  <span>New career</span>
                </Button>
              </m.div>
            )}
            {!installed() && (
              <m.p {...rise} className="small muted" style={{ maxWidth: 360, marginTop: 6 }}>
                For full-screen offline play on iPhone or iPad: Share, then Add to Home Screen.
              </m.p>
            )}
          </m.div>
        )}
      </div>

      {menu && (
        <div style={{ position: 'absolute', top: 'var(--gut-t)', right: 'var(--gut-r)' }}>
          <IconButton name="gear" label="Settings" onClick={() => setSettings(true)} />
        </div>
      )}
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
      <ConfirmSheet
        open={confirmNew}
        title="New career"
        body="Start over as a co-angler? Your cash, tackle and results will be erased."
        confirmLabel="Erase & start"
        danger
        onConfirm={startNew}
        onClose={() => setConfirmNew(false)}
      />
    </>
  );
}
