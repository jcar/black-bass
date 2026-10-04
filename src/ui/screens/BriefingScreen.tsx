import { LAKES, TIER_FORMAT } from '../../data/lakes';
import { COLORS, LURES } from '../../data/lures';
import { lineLabel } from '../../data/rods';
import { unlockAudio } from '../../audio/sound';
import { useStore } from '../../state/store';
import { conditionsAdvice, WEATHER_LABEL } from '../advice';
import { LureIcon, Stat } from '../components';

export function BriefingScreen() {
  const t = useStore((s) => s.tournament);
  const setScreen = useStore((s) => s.setScreen);
  if (!t) return null;
  const lake = LAKES[t.lakeId];
  const c = t.conditions;
  const fmt = TIER_FORMAT[t.tier];
  const date = new Date(`${c.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <div className="screen col" style={{ gap: 14 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3>
            {t.tier === 'Amateur' ? 'Co-Angler' : t.tier} Series · Day {t.day} of {t.totalDays}
          </h3>
          <h1>{lake.name}</h1>
          <div className="muted">{lake.blurb}</div>
        </div>
        <button
          className="btn primary"
          style={{ fontSize: 18, padding: '14px 28px' }}
          onClick={() => {
            unlockAudio();
            setScreen('game');
          }}
        >
          Blast off ›
        </button>
      </div>
      <div className="panel row wrap" style={{ gap: 26 }}>
        <Stat label="Date" value={date} />
        <Stat label="Season" value={c.season} />
        <Stat label="Water" value={`${c.waterTempF.toFixed(0)}°F ${c.tempTrendFPerDay >= 0 ? '↗' : '↘'}`} />
        <Stat label="Sky" value={WEATHER_LABEL[c.weather]} />
        <Stat label="Wind" value={`${c.windMph} mph`} />
        <Stat label="Barometer" value={c.pressureTrend + (c.postFront ? ' (post-front)' : '')} />
        <Stat label="Field" value={`${fmt.fieldSize} anglers`} />
        <Stat label="Weigh-in" value="3:00 PM" />
      </div>
      <div className="row wrap" style={{ alignItems: 'stretch' }}>
        <div className="panel col grow" style={{ minWidth: 280 }}>
          <h3>Dock talk</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="col small">
            {conditionsAdvice(c, lake.clarity.defaultSecchiFt).map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
        <div className="panel col grow" style={{ minWidth: 260 }}>
          <h3>On deck</h3>
          {t.deck.map((d, i) => (
            <div key={d.id} className="row small">
              <LureIcon lureId={d.lureId} colorId={d.colorId} />
              <span>
                <strong>
                  {i + 1}. {LURES[d.lureId].name}
                </strong>{' '}
                ({COLORS[d.colorId].name}) · {lineLabel(d.line)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel small muted">
        Controls: left thumb steers the boat, aims and works the rod (tap to twitch, flick down to bow). Right thumb: Fish/Cast, Reel, Thumb brake. Five best
        bass count; a sixth means you cull your smallest. Shorts under 12" and other species don't count.
      </div>
    </div>
  );
}
