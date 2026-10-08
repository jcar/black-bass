// The logbook tab of the trophy room: every bass landed, filters by lake, and what's been working
// (best lures by lake and by season, by count or by weight), plus the record fish and its lure.
import { useMemo, useState } from 'react';
import { LAKE_LADDER, LAKES } from '../../data/lakes';
import { COLORS, LURES } from '../../data/lures';
import { lineLabel } from '../../data/rods';
import { SPECIES } from '../../data/species';
import { formatClock } from '../../sim/conditions';
import type { CoverType, Season } from '../../sim/types';
import { groupLog, heaviest, rankLogLures, type LogEntry } from '../../state/logbook';
import { lakeName, useStore } from '../../state/store';
import { lbOz, LureIcon } from '../components';
import { Segmented } from '../kit';

const SEASONS: Season[] = ['Prespawn', 'Spawn', 'Postspawn', 'Summer', 'Fall', 'Turnover', 'Winter'];
const COVER: Record<CoverType, string> = { none: 'open water', rock: 'rock', grass: 'grass', dock: 'docks', timber: 'laydowns', reeds: 'reeds', standing: 'standing timber' };
/** Rows drawn at once (the log keeps 500). */
const SHOW = 80;

const lureName = (e: Pick<LogEntry, 'lureId' | 'colorId'>) => `${LURES[e.lureId]?.name ?? e.lureId}${e.colorId && COLORS[e.colorId] ? ` (${COLORS[e.colorId].name.toLowerCase()})` : ''}`;

function where(e: LogEntry): string {
  const parts: string[] = [];
  if (e.depthFt !== undefined) parts.push(`${Math.round(e.depthFt)} ft${e.bottomFt !== undefined ? ` over ${Math.round(e.bottomFt)}` : ''}`);
  if (e.cover) parts.push(COVER[e.cover]);
  return parts.join(', ');
}

function TopLures({ title, groups, by }: { title: string; groups: { key: string; entries: LogEntry[] }[]; by: 'count' | 'weight' }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <span className="kicker">{title}</span>
      {groups.map((g) => {
        const top = rankLogLures(g.entries, by).slice(0, 3);
        return (
          <div key={g.key} className="log-group">
            <span className="log-group-name">{g.key}</span>
            {top.map((l) => (
              <span key={l.lureId} className="log-lure">
                <LureIcon lureId={l.lureId} colorId={LURES[l.lureId]?.colors?.[0] ?? ''} size={22} />
                {LURES[l.lureId]?.short ?? l.lureId}
                <b className="num">{by === 'count' ? l.count : lbOz(l.totalLb)}</b>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function Logbook() {
  const log = useStore((s) => s.save.logbook);
  const [lake, setLake] = useState<string>('all');
  const [by, setBy] = useState<'count' | 'weight'>('count');
  const lakes = useMemo(() => LAKE_LADDER.filter((l) => LAKES[l.id] && log.some((e) => e.lakeId === l.id)).map((l) => l.id), [log]);
  const shown = useMemo(() => (lake === 'all' ? log : log.filter((e) => e.lakeId === lake)), [log, lake]);
  const record = useMemo(() => heaviest(shown), [shown]);
  const byLake = useMemo(() => groupLog(shown, (e) => lakeName(e.lakeId)), [shown]);
  const bySeason = useMemo(() => groupLog(shown, (e) => e.season, SEASONS), [shown]);
  const recent = useMemo(() => [...shown].reverse().slice(0, SHOW), [shown]);

  if (log.length === 0) return <p className="muted">No bass logged yet. Every bass you land is written here: the lure, the line, the conditions and where it bit.</p>;
  return (
    <div className="row grow logbook" style={{ alignItems: 'stretch', gap: 16, minHeight: 0 }}>
      <div className="col log-side" style={{ gap: 10, minHeight: 0, overflowY: 'auto' }}>
        {lakes.length > 1 && <Segmented value={lake} onChange={setLake} options={[{ value: 'all', label: 'All lakes' }, ...lakes.map((id) => ({ value: id, label: lakeName(id) }))]} />}
        {record && (
          <div className="panel log-record">
            <span className="kicker">Record bass</span>
            <span className="display" style={{ fontSize: 26, lineHeight: 1 }}>
              {lbOz(record.weightLb)} <span className="unit">lb</span> {SPECIES[record.species].name}
            </span>
            <span className="row small" style={{ gap: 6 }}>
              <LureIcon lureId={record.lureId} colorId={record.colorId ?? LURES[record.lureId]?.colors[0] ?? ''} size={28} /> {lureName(record)}
            </span>
            <span className="small muted">
              {lakeName(record.lakeId)} · {record.date} · {formatClock(record.clockMin)}
            </span>
          </div>
        )}
        <Segmented value={by} onChange={setBy} options={[{ value: 'count', label: 'By count' }, { value: 'weight', label: 'By weight' }]} />
        {lake === 'all' && byLake.length > 1 && <TopLures title="Best lures by lake" groups={byLake} by={by} />}
        <TopLures title={lake === 'all' && byLake.length > 1 ? 'Best lures by season' : `Best lures by season · ${lakeName(shown[0]?.lakeId ?? '')}`} groups={bySeason} by={by} />
      </div>
      <div className="col grow log-list" style={{ gap: 3, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        <span className="kicker">
          {shown.length} bass{shown.length > SHOW ? ` · latest ${SHOW}` : ''}
        </span>
        {recent.map((e) => (
          <div key={e.id} className={`log-row ${e.keeper ? '' : 'short'}`}>
            <span className="log-w num">{lbOz(e.weightLb)}</span>
            <LureIcon lureId={e.lureId} colorId={e.colorId ?? LURES[e.lureId]?.colors[0] ?? ''} size={30} />
            <span className="log-main">
              <span>
                {SPECIES[e.species].name} · {e.lengthIn}"{e.keeper ? '' : ' · short'} · {lureName(e)}
                {e.line ? ` · ${lineLabel(e.line)}` : ''}
              </span>
              <span className="small muted">
                {lakeName(e.lakeId)} day {e.day} · {formatClock(e.clockMin)} · {e.weather} · {e.waterTempF}°F{where(e) ? ` · ${where(e)}` : ''}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
