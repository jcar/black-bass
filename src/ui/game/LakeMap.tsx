import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playUi } from '../../audio/sound';
import { LAKES } from '../../data/lakes';
import { paintLakeCanvas } from '../../render/lakeTexture';
import { getLakeGrid } from '../../sim/lake';
import { distanceM, nextStop, OFF_PLANE_M, scaleBarM, type NavStop } from '../../sim/nav';
import { useStore } from '../../state/store';
import { Icon, useEscapeClose } from '../kit';

/** Chart resolution for the full map (px per m); CSS scales it to fit the screen. */
const PAINT_PX_PER_M = 0.25;
/** A tap this close (screen px) to a pin picks it, so small pins on a phone are easy to hit. */
const TAP_PX = 30;
/** A waypoint this close (m) to a PRO stop is the same place: one pin. */
const SAME_SPOT_M = 30;

const charts = new Map<string, HTMLCanvasElement>();
function chartFor(lakeId: string): HTMLCanvasElement {
  let c = charts.get(lakeId);
  if (!c) {
    c = paintLakeCanvas(getLakeGrid(LAKES[lakeId]), PAINT_PX_PER_M);
    charts.set(lakeId, c);
  }
  return c;
}

const keyboardOnly = () => typeof window !== 'undefined' && !('ontouchstart' in window) && navigator.maxTouchPoints === 0;
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/**
 * Full-screen lake chart: waypoints, the numbered PRO route, your boat and heading, the launch, boat
 * lanes and stump fields, and a scale bar. Tap a stop (or pick it from the list) to drive there. The
 * clock stops while it's open, the same as the pause menu: it's a planning screen, not a live view.
 */
export function LakeMap() {
  const open = useStore((s) => s.mapOpen);
  return open ? <LakeMapPanel /> : null;
}

function LakeMapPanel() {
  const t = useStore((s) => s.tournament);
  const { route, visited } = useStore((s) => s.navRoute);
  const target = useStore((s) => s.navTarget);
  const setNavTarget = useStore((s) => s.setNavTarget);
  const path = useStore((s) => s.navPath);
  const close = () => useStore.getState().setMapOpen(false);
  useEscapeClose(true, close);

  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lakeId = t?.lakeId ?? 'champlain';
  const lake = LAKES[lakeId];
  const W = lake.sizeM.w;
  const H = lake.sizeM.h;
  const k = size.w && size.h ? Math.min(size.w / W, size.h / H) : 0;
  const shown = k > 0;
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const src = chartFor(lakeId);
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
  }, [lakeId, shown]);

  const done = useMemo(() => new Set(visited), [visited]);
  const waypoints = useMemo<NavStop[]>(
    () => lake.waypoints.filter((w) => w.visible).map((w) => ({ id: w.id, name: w.name, x: w.x, y: w.y })),
    [lake],
  );
  // A waypoint the route also stops at is drawn once, as the PRO pin (named after the waypoint).
  const plainWaypoints = waypoints.filter((w) => !route.some((r) => r.id === w.id || distanceM(r, w) < SAME_SPOT_M));
  const dest = target ?? nextStop(route, done);

  const pick = (s: NavStop | null) => {
    playUi('confirm');
    setNavTarget(s);
    close();
  };

  // Keyboard: 1-9 picks that PRO stop, 0 goes back to following the route.
  const pickRef = useRef(pick);
  useEffect(() => {
    pickRef.current = pick;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !/^[0-9]$/.test(e.key)) return;
      const n = Number(e.key);
      if (n === 0) pickRef.current(null);
      else if (route[n - 1]) pickRef.current(route[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route]);

  if (!t) return null;
  const boat = t.boat;
  const pct = (p: { x: number; y: number }) => ({ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` });
  const bar = k ? scaleBarM(k, 110) : 0;

  const onChartDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!k) return;
    const r = e.currentTarget.getBoundingClientRect();
    const at = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    let best: NavStop | null = null;
    for (const s of [...route, ...plainWaypoints]) if (distanceM(at, s) * k <= TAP_PX && (!best || distanceM(at, s) < distanceM(at, best))) best = s;
    if (best) pick(best);
  };

  // Waypoint labels sit right of the pin; flip left when that would overprint an earlier label, or hide
  // (the list still has it) when both sides collide.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const margin = Math.max(0, (size.w - W * k) / 2 - 4);
  const labelSide = (s: NavStop): 'r' | 'l' | null => {
    if (!k) return null;
    const w = s.name.length * 6.2 + 8;
    const x = s.x * k;
    const y = s.y * k;
    for (const side of ['r', 'l'] as const) {
      const box = side === 'r' ? { x0: x + 11, x1: x + 11 + w, y0: y - 8, y1: y + 8 } : { x0: x - 11 - w, x1: x - 11, y0: y - 8, y1: y + 8 };
      // Labels may run into the dark margin beside the chart, not off the panel.
      if (box.x0 < -margin || box.x1 > W * k + margin) continue;
      if (placed.some((p) => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1)) continue;
      placed.push(box);
      return side;
    }
    return null;
  };
  for (const r of route) placed.push({ x0: r.x * k - 9, x1: r.x * k + 9, y0: r.y * k - 9, y1: r.y * k + 9 });

  const kb = keyboardOnly();
  return (
    <div className="lakemap" role="dialog" aria-label="Lake map">
      <div className="lakemap-box" ref={box}>
        {k > 0 && (
          <div className="lakemap-chart" style={{ width: W * k, height: H * k }} onPointerDown={onChartDown}>
            <canvas ref={canvas} />
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              {(lake.stumpZones ?? []).map((z, i) => (
                <circle key={i} cx={z.x} cy={z.y} r={z.r} className="lm-stumps" vectorEffect="non-scaling-stroke" />
              ))}
              {route.length > 1 && <polyline points={route.map((s) => `${s.x},${s.y}`).join(' ')} className="lm-route" vectorEffect="non-scaling-stroke" />}
              {dest && (
                <>
                  <polyline points={[boat.pos, ...(path.length ? path : [dest])].map((p) => `${p.x},${p.y}`).join(' ')} className="lm-course" vectorEffect="non-scaling-stroke" />
                  <circle cx={dest.x} cy={dest.y} r={OFF_PLANE_M} className="lm-offplane" vectorEffect="non-scaling-stroke" />
                </>
              )}
            </svg>
            <div className="lm-launch" style={pct(lake.launch)} title={lake.launch.name} />
            {plainWaypoints.map((w) => {
              const side = labelSide(w);
              return (
                <div key={w.id} className={`lm-pin wp ${dest?.id === w.id ? 'dest' : ''}`} style={pct(w)}>
                  {side && <span className={`lm-label ${side}`}>{w.name}</span>}
                </div>
              );
            })}
            {route.map((s) => {
              // A PRO stop on a charted waypoint keeps the waypoint's name on the chart.
              const wp = waypoints.find((w) => w.id === s.id || distanceM(w, s) < SAME_SPOT_M);
              const side = wp ? labelSide(wp) : null;
              return (
                <div key={s.id} className={`lm-pin pro ${done.has(s.id) ? 'done' : ''} ${dest?.id === s.id ? 'dest' : ''}`} style={pct(s)}>
                  {s.pro}
                  {wp && side && <span className={`lm-label ${side}`}>{wp.name}</span>}
                </div>
              );
            })}
            <div className="lm-boat" style={{ ...pct(boat.pos), transform: `translate(-50%, -50%) rotate(${boat.heading}rad)` }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22 12L4 4l4 8-4 8z" />
              </svg>
            </div>
            <div className="lm-scale" aria-label={`Scale: ${fmtM(bar)}`}>
              <div className="bar" style={{ width: bar * k }} />
              <span>{fmtM(bar)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="lakemap-side">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <div className="col" style={{ gap: 2 }}>
            <strong className="lm-title">{lake.name}</strong>
            <span className="badge">Clock paused</span>
          </div>
          <button className="icon-btn" aria-label="Close map" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <span className="small lm-hint">{kb ? 'Click a stop, or 1-9 for a PRO stop, 0 to follow the route · M/Esc close' : 'Tap a stop to drive there'}</span>
        {route.length > 0 && (
          <>
            <span className="kicker">Pro route</span>
            {target && (
              <button className="lm-row" onClick={() => pick(null)}>
                <span className="lm-num auto">
                  <Icon name="next" size={14} />
                </span>
                <span className="lm-name">Follow the route</span>
              </button>
            )}
            {route.map((s) => (
              <button key={s.id} className={`lm-row ${dest?.id === s.id ? 'dest' : ''} ${done.has(s.id) ? 'done' : ''}`} onClick={() => pick(s)}>
                <span className="lm-num">{s.pro}</span>
                <span className="lm-name">{s.name}</span>
                <span className="lm-dist">{done.has(s.id) ? <Icon name="check" size={14} /> : fmtM(distanceM(boat.pos, s))}</span>
              </button>
            ))}
          </>
        )}
        <span className="kicker">Waypoints</span>
        {waypoints.map((w) => (
          <button key={w.id} className={`lm-row ${dest?.id === w.id ? 'dest' : ''}`} onClick={() => pick(w)}>
            <span className="lm-num wp" />
            <span className="lm-name">{w.name}</span>
            <span className="lm-dist">{fmtM(distanceM(boat.pos, w))}</span>
          </button>
        ))}
        <div className="lm-legend small">
          <span>
            <i className="lg-boat" /> You
          </span>
          <span>
            <i className="lg-launch" /> Launch
          </span>
          <span>
            <i className="lg-ring" /> Off plane {OFF_PLANE_M} m
          </span>
          {(lake.lanes?.length ?? 0) > 0 && (
            <span>
              <i className="lg-lane" /> Boat lane
            </span>
          )}
          {(lake.stumpZones?.length ?? 0) > 0 && (
            <span>
              <i className="lg-stumps" /> Stumps
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
