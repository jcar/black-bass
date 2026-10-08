import { setSoundEnabled } from '../audio/sound';
import { useStore } from '../state/store';
import { Sheet, Switch } from './kit';

/** Shared settings sheet (title, marina and the pause menu). */
export function SettingsSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children?: React.ReactNode }) {
  const settings = useStore((s) => s.save.settings);
  const mutateSave = useStore((s) => s.mutateSave);
  const set = (k: 'sound' | 'leftHanded' | 'debugMeter' | 'coach' | 'anglersEye' | 'autoHookset', v: boolean) =>
    mutateSave((s) => {
      s.settings[k] = v;
      if (k === 'sound') setSoundEnabled(v);
    });
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="col" style={{ gap: 0 }}>
        <Switch label="Sound & music" checked={settings.sound} onChange={(v) => set('sound', v)} />
        <Switch label="Left-handed controls" checked={settings.leftHanded} onChange={(v) => set('leftHanded', v)} />
        <Switch label="Auto hookset (off: set the hook yourself with HOOK / H when a fish has it)" checked={settings.autoHookset} onChange={(v) => set('autoHookset', v)} />
        <Switch label="Coach tips & retrieve meter" checked={settings.coach} onChange={(v) => set('coach', v)} />
        <Switch label="Angler's Eye (show the lure-action number, like the NES MIRUN code)" checked={settings.anglersEye} onChange={(v) => set('anglersEye', v)} />
        <Switch label="Show attraction meter" checked={settings.debugMeter} onChange={(v) => set('debugMeter', v)} />
      </div>
      {children}
    </Sheet>
  );
}
