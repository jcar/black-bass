import { unlockAudio } from '../../audio/sound';
import { clearSave, newSave, writeSave } from '../../state/save';
import { useStore } from '../../state/store';
import { lakeName } from '../../state/store';

export function TitleScreen() {
  const save = useStore((s) => s.save);
  const setScreen = useStore((s) => s.setScreen);
  const resume = useStore((s) => s.resumeTournament);
  const active = save.activeTournament;
  const hasCareer = save.history.length > 0 || !!active;

  const startNew = () => {
    if (hasCareer && !confirm('Start a new career? Your current progress will be erased.')) return;
    clearSave();
    const fresh = newSave();
    writeSave(fresh);
    useStore.setState({ save: fresh, tournament: null });
    setScreen('hub');
  };

  return (
    <div className="screen" onPointerDown={unlockAudio} style={{ display: 'grid', placeItems: 'center' }}>
      <div className="col" style={{ alignItems: 'center', gap: 18, textAlign: 'center' }}>
        <div style={{ fontSize: 13, letterSpacing: '0.4em', color: 'var(--accent)', fontWeight: 800 }}>PRO TOUR</div>
        <h1 style={{ fontSize: 'clamp(36px, 8vw, 64px)', lineHeight: 1 }}>BLACK BASS</h1>
        <p className="muted" style={{ maxWidth: 460, margin: 0 }}>
          Climb from co-angler to the Elite series on North America's legendary bass lakes.
        </p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          {active && (
            <button className="btn primary" onClick={resume}>
              Resume Tournament: {lakeName(active.lakeId)}, Day {active.day}
            </button>
          )}
          {hasCareer ? (
            <button className={active ? 'btn' : 'btn primary'} onClick={() => setScreen('hub')}>
              Continue Career
            </button>
          ) : (
            <button className="btn primary" onClick={() => setScreen('hub')}>
              Start Career
            </button>
          )}
          {hasCareer && (
            <button className="btn" onClick={startNew}>
              New Career
            </button>
          )}
        </div>
        <p className="small muted" style={{ maxWidth: 520 }}>
          Best played in landscape. On iPhone/iPad: Share → Add to Home Screen for full-screen, offline play.
        </p>
      </div>
    </div>
  );
}
