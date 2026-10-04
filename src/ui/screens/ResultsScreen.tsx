import { PURSE } from '../../data/lakes';
import { SPECIES } from '../../data/species';
import { isTournamentOver, playerCut, standings } from '../../sim/tournament';
import { lakeName, useStore } from '../../state/store';
import { lbOz, money } from '../components';

export function ResultsScreen() {
  const t = useStore((s) => s.tournament);
  const nextDay = useStore((s) => s.nextDay);
  const complete = useStore((s) => s.completeTournament);
  if (!t) return null;
  const st = standings(t, true);
  const myIdx = st.findIndex((x) => x.isPlayer);
  const over = isTournamentOver(t);
  const cut = playerCut(t);
  const shown = st.slice(0, 10);
  if (myIdx >= 10) shown.push(st[myIdx]);
  const purse = PURSE[t.tier];
  const today = t.dayWeights[t.dayWeights.length - 1] ?? 0;

  return (
    <div className="screen col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3>
            Weigh-in · Day {t.day} of {t.totalDays}
          </h3>
          <h1>{lakeName(t.lakeId)}</h1>
        </div>
        {over ? (
          <button className="btn primary" onClick={complete}>
            {cut ? 'Missed the cut: back to the hub' : 'Collect winnings ›'}
          </button>
        ) : (
          <button className="btn primary" onClick={nextDay}>
            Start Day {t.day + 1} ›
          </button>
        )}
      </div>
      <div className="row wrap" style={{ alignItems: 'stretch' }}>
        <div className="panel col" style={{ minWidth: 240 }}>
          <h3>Your bag</h3>
          <div className="big">{lbOz(today)} lb</div>
          <div className="small muted">
            Place: #{myIdx + 1} of {st.length}
            {over && purse.payouts[myIdx] ? ` · ${money(purse.payouts[myIdx])}` : ''}
          </div>
          <div className="col small" style={{ gap: 4 }}>
            {t.livewell.map((f, i) => (
              <span key={i}>
                {SPECIES[f.species].name}: {lbOz(f.weightLb)} ({f.lengthIn}")
              </span>
            ))}
            {t.livewell.length === 0 && <span className="muted">No keepers today.</span>}
          </div>
          <div className="small muted">
            Casts {t.stats.casts} · Bites {t.stats.bites} · Lost {t.stats.lost} · Bycatch {t.stats.bycatch}
          </div>
        </div>
        <div className="panel grow" style={{ minWidth: 300 }}>
          <table className="standings">
            <tbody>
              {shown.map((r) => {
                const place = st.indexOf(r) + 1;
                return (
                  <tr key={r.id} className={`${r.isPlayer ? 'me' : ''} ${r.cut ? 'cut' : ''}`}>
                    <td>#{place}</td>
                    <td>{r.name}</td>
                    <td>{lbOz(r.today)}</td>
                    <td>
                      <strong>{lbOz(r.total)}</strong>
                    </td>
                    <td className="muted">{over && purse.payouts[place - 1] ? money(purse.payouts[place - 1]) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
