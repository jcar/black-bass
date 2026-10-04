import { LAKE_LADDER, PURSE } from '../../data/lakes';
import { RANK_LABEL, PROMOTE_TOP } from '../../state/career';
import { lakeName, useStore } from '../../state/store';
import { lbOz, money, Stat } from '../components';

export function HubScreen() {
  const save = useStore((s) => s.save);
  const selected = useStore((s) => s.selectedLake);
  const selectLake = useStore((s) => s.selectLake);
  const setScreen = useStore((s) => s.setScreen);
  const start = useStore((s) => s.startTournament);
  const resume = useStore((s) => s.resumeTournament);
  const lastResult = useStore((s) => s.lastResult);
  const mutateSave = useStore((s) => s.mutateSave);
  const sel = LAKE_LADDER.find((l) => l.id === selected)!;
  const entry = PURSE[sel.tier].entry;
  const active = save.activeTournament;

  return (
    <div className="screen col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 18 }}>
          <button className="btn" onClick={() => setScreen('title')} aria-label="Back to title">
            ‹
          </button>
          <div>
            <h3>{RANK_LABEL[save.player.rank]}</h3>
            <h2>{save.player.name}</h2>
          </div>
          <Stat label="Cash" value={money(save.player.cash)} />
          <Stat label="Points" value={save.player.rankPoints} />
          <Stat label="Best bag" value={`${lbOz(save.personalBests.bestBagLb)} lb`} />
          <Stat label="Big fish" value={`${lbOz(save.personalBests.bigFishLb)} lb`} />
        </div>
        <div className="row">
          <button className="btn" onClick={() => setScreen('shop')}>
            Tackle Shop
          </button>
          <button className="btn" onClick={() => setScreen('deck')}>
            Rod Deck
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="panel row wrap" style={{ borderColor: 'var(--accent)' }}>
          <strong>
            {lakeName(lastResult.result.lakeId)}: finished #{lastResult.result.place} of {lastResult.result.fieldSize} with {lbOz(lastResult.result.totalLb)} lb.
          </strong>
          <span className="muted">
            {lastResult.result.payout > 0 ? `Won ${money(lastResult.result.payout)}.` : 'Out of the money.'} +{lastResult.result.points} pts.
          </span>
          {lastResult.promoted && <strong style={{ color: 'var(--good)' }}>Promoted! {lastResult.promoted} unlocked.</strong>}
        </div>
      )}

      <h3>Tour schedule</h3>
      <div className="grid2">
        {LAKE_LADDER.map((l) => {
          const unlocked = save.unlockedLakes.includes(l.id);
          const playable = unlocked && l.available;
          return (
            <button
              key={l.id}
              className={`lake-card ${selected === l.id ? 'sel' : ''} ${playable ? '' : 'locked'}`}
              onClick={() => playable && selectLake(l.id)}
              disabled={!playable}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>{l.name}</h2>
                <span className="chip">{l.tier === 'SemiPro' ? 'Semi-Pro' : l.tier}</span>
              </div>
              <div className="muted small">{l.region}</div>
              <div className="small" style={{ marginTop: 8 }}>
                {!unlocked ? `Locked: finish top ${PROMOTE_TOP} on the previous lake.` : !l.available ? 'Coming in a later milestone.' : `Entry ${money(PURSE[l.tier].entry)} · 1st pays ${money(PURSE[l.tier].payouts[0])}`}
              </div>
            </button>
          );
        })}
      </div>

      <div className="row wrap">
        {active ? (
          <>
            <button className="btn primary" onClick={resume}>
              Resume {lakeName(active.lakeId)} (Day {active.day})
            </button>
            <button
              className="btn danger"
              onClick={() => confirm('Withdraw from this tournament? Your entry fee is lost.') && useStore.getState().abandonTournament()}
            >
              Withdraw
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={save.player.cash < entry} onClick={() => start()}>
            Enter {sel.name}: {money(entry)}
          </button>
        )}
        {save.player.cash < entry && !active && <span className="muted small">Not enough cash for the entry fee.</span>}
        <label className="row small muted" style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={save.settings.debugMeter}
            onChange={(e) => mutateSave((s) => void (s.settings.debugMeter = e.target.checked))}
          />
          Show attraction meter
        </label>
      </div>

      {save.history.length > 0 && (
        <div className="panel">
          <h3 style={{ marginBottom: 8 }}>Recent results</h3>
          <table className="standings">
            <tbody>
              {save.history.slice(0, 6).map((h, i) => (
                <tr key={i}>
                  <td>{h.date}</td>
                  <td>{lakeName(h.lakeId)}</td>
                  <td>
                    #{h.place}/{h.fieldSize}
                  </td>
                  <td>{lbOz(h.totalLb)} lb</td>
                  <td>{money(h.payout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
