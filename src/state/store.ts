import { create } from 'zustand';
import { LAKES } from '../data/lakes';
import { PURSE } from '../data/lakes';
import { LURES } from '../data/lures';
import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { dayPlan, pointData, proPickNow, windowAt, type PointVerdict, type WindowPlan } from '../sim/advisor';
import { formatClock } from '../sim/conditions';
import { bagWeight, resolveCull, continueAfterLanded } from '../sim/livewell';
import { atLaunch, etaHomeMin, lateMinutes, leaveByMin, type NavCue, type NavStop } from '../sim/nav';
import { getLakeGrid } from '../sim/lake';
import { biteAtSec } from '../sim/presentation';
import { adviceFor } from '../sim/tierAdvice';
import { canCheckIn, createTournament, isTournamentOver, spendMinutes, standings, startNextDay, switchRod } from '../sim/tournament';
import type { CaughtFish, GamePhase, TournamentState, Vec2, Weather } from '../sim/types';
import { applyResult, tierOfLake } from './career';
import type { TournamentResult } from './save';
import { loadSave, writeSave, type SaveData } from './save';

export type Screen = 'title' | 'hub' | 'events' | 'trophies' | 'shop' | 'deck' | 'briefing' | 'game' | 'results';

/** Coarse HUD snapshot published ~10x/sec from the game loop (React never reads sim state per frame). */
export interface Hud {
  phase: GamePhase;
  clock: string;
  clockMin: number;
  day: number;
  totalDays: number;
  livewell: CaughtFish[];
  bag: number;
  place: number;
  fieldSize: number;
  leaders: { name: string; total: number; isPlayer: boolean }[];
  activeRod: number;
  rodLabels: string[];
  canFish: boolean;
  motor: 'outboard' | 'trolling';
  castCharging: boolean;
  castFlying: boolean;
  tension: number;
  stamina: number;
  fishName: string | null;
  jumping: boolean;
  meter: number;
  match: number;
  lureDepth: number;
  nearWaypoint: { name: string; tip: string } | null;
  pendingCull: CaughtFish | null;
  lastLanded: CaughtFish | null;
  /** Advisor's rig for right now: the day plan's, unless the water here clearly suits another (deck index; -1 = no Pro chip at this tier). */
  proPick: number;
  /** Where you're driving (Navigate only): the next unfished PRO stop, or the one you picked on the map. */
  nav: NavHud | null;
  /** Within casting range of the destination, a PRO stop or a charted waypoint: the FISH button lights up. */
  inRange: boolean;
  /** A strike in progress: 'wait' while the fish closes on it (or blows up on a topwater), 'set' once it has the bait. */
  hook: 'none' | 'wait' | 'set';
  /** Getting back for check-in. */
  checkIn: CheckInHud;
}

export interface CheckInHud {
  /** Game minutes to run back to the launch from here. */
  etaMin: number;
  /** Leave by this clock to make check-in with the usual margin ("2:38 PM"). */
  leaveBy: string;
  /** The "head in" warning has gone off (or it's past check-in time). */
  headIn: boolean;
  /** Past check-in time (penalties start a minute later, at 3:01). */
  late: boolean;
  /** Minutes late so far (past check-in time). */
  lateMin: number;
  atLaunch: boolean;
  /** The CHECK IN button/key works now (at the launch, between casts, after check-in opens). */
  can: boolean;
}

export interface NavHud {
  name: string;
  /** Route number when the destination is a PRO stop. */
  pro: number | null;
  distM: number;
  /** Which way to steer, relative to the boat's heading (rad): 0 dead ahead, positive to starboard. Follows the water route. */
  rel: number;
  /** Land is in the way: the arrow points along the water route, not straight at the stop. */
  routed: boolean;
  /** Compass point to steer for now (along the route). */
  steerCompass: string;
  /** Compass point from the boat ("NE"). */
  compass: string;
  cue: NavCue;
  outboard: boolean;
  /** Picked on the map, rather than the route's next stop. */
  manual: boolean;
  /** The destination is the launch (time to head in for check-in). */
  home?: boolean;
}

/**
 * In-game notices, by priority (broadcast-graphics rules: the more urgent, the more disruptive):
 * - banner: centre screen, rare moments (line break, stump, time). One at a time, short.
 * - bug:    the scorebug expands with a strip (30-minute warning, place change). Replaces the last.
 * - ticker: the live feed (rival catches, lead changes). Queued, shown one at a time, held during
 *           fights and the catch card.
 * Cast results are spatial callouts in the scene, not notices.
 */
export type NoticeKind = 'banner' | 'bug' | 'ticker' | 'coach';
export type NoticeTone = 'info' | 'good' | 'bad' | 'gold';
export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  sub?: string;
  tone: NoticeTone;
}

interface StoreState {
  save: SaveData;
  screen: Screen;
  selectedLake: string;
  tournament: TournamentState | null;
  hud: Hud | null;
  notices: Notice[];
  paused: boolean;
  /** The full lake map is open (the clock stops, like the pause menu). */
  mapOpen: boolean;
  setMapOpen: (open: boolean) => void;
  /** A stop picked on the full map; null follows the PRO route. */
  navTarget: NavStop | null;
  setNavTarget: (s: NavStop | null) => void;
  /** Today's PRO route for the rig in hand and the stops already fished (published by the runner on change). */
  navRoute: { route: NavStop[]; visited: string[] };
  setNavRoute: (r: { route: NavStop[]; visited: string[] }) => void;
  /** Water route from the boat to the destination (for the lake map's course line). */
  navPath: Vec2[];
  setNavPath: (p: Vec2[]) => void;
  lastResult: { result: TournamentResult; promoted: string | null } | null;
  /** The last "Data for this point" reading (n increments on each check so the lower-third replays). */
  point: PointInfo | null;
  /** Read the data for the water around the boat (Cast phase). `manual` = the player asked (may cost time at Pro). */
  checkPoint: (manual: boolean) => void;
  clearPoint: () => void;

  setScreen: (s: Screen) => void;
  mutateSave: (fn: (s: SaveData) => void) => void;
  persist: () => void;
  selectLake: (id: string) => void;
  startTournament: (seed?: number) => void;
  resumeTournament: () => void;
  abandonTournament: () => void;
  setHud: (h: Hud) => void;
  notify: (n: Omit<Notice, 'id'>) => void;
  dismissNotice: (id: number) => void;
  setPaused: (p: boolean) => void;
  cull: (releaseIndex: number) => void;
  continueFishing: () => void;
  selectRod: (i: number) => void;
  finishDay: () => void;
  /** The coach's notes on the day just fished (weigh-in). */
  debrief: string[];
  setDebrief: (d: string[]) => void;
  nextDay: () => void;
  completeTournament: () => void;
  /** Copy the edited rod locker into the tournament (only before launching for the day). */
  rerigBeforeLaunch: () => void;
  /** Blast off from the briefing: the day starts on the plan's rod for the first window. */
  launchDay: () => void;
}

export interface PointInfo {
  n: number;
  verdict: PointVerdict;
  clock: string;
  weather: Weather;
  waterTempF: number;
  /** Game minutes the check cost (Pro tier). */
  costMin: number;
}
let pointN = 0;

/** Before blast-off each day you can still re-rig: nothing has happened on the water yet. */
export const canRerig = (t: TournamentState | null) => !!t && t.phase === 'Navigate' && t.clockMin === TUNING.clock.dayStartMin;

/** Today's pro plan for the tournament's deck (memoised: the HUD asks for it 10x a second). */
let planCache: { key: string; plan: WindowPlan[] } | null = null;
export function planFor(t: TournamentState): WindowPlan[] {
  const key = `${t.lakeId}:${t.seed}:${t.day}:${JSON.stringify(t.deck)}`;
  if (planCache?.key !== key) planCache = { key, plan: dayPlan(LAKES[t.lakeId], t.conditions, t.deck) };
  return planCache.plan;
}

/** The plan's rod for the window the clock is in (deck index). */
const plannedRod = (t: TournamentState) => planFor(t).find((p) => p.window.id === windowAt(t.clockMin).id)?.best ?? 0;

let noticeId = 1;
const NOTICE_MS: Partial<Record<NoticeKind, number>> = { banner: 2300, bug: 3200, coach: 9000 };
const MAX_TICKER_QUEUE = 3;

export const useStore = create<StoreState>((set, get) => ({
  save: loadSave(),
  screen: 'title',
  selectedLake: 'champlain',
  tournament: null,
  hud: null,
  notices: [],
  debrief: [],
  setDebrief: (debrief) => set({ debrief }),
  paused: false,
  mapOpen: false,
  setMapOpen: (mapOpen) => set({ mapOpen }),
  navTarget: null,
  setNavTarget: (navTarget) => set({ navTarget }),
  navRoute: { route: [], visited: [] },
  setNavRoute: (navRoute) => set({ navRoute }),
  navPath: [],
  setNavPath: (navPath) => set({ navPath }),
  lastResult: null,
  point: null,
  checkPoint: (manual) => {
    const t = get().tournament;
    if (!t || t.phase !== 'Cast') return;
    const cost = adviceFor(t.tier).pointDataMin;
    if (cost === null || (!manual && cost > 0)) return;
    if (cost > 0 && !spendMinutes(t, cost)) return;
    const d = pointData(LAKES[t.lakeId], t.conditions, t.clockMin, t.boat.pos);
    set({ point: { n: ++pointN, verdict: d.verdict, clock: formatClock(t.clockMin), weather: t.conditions.weather, waterTempF: Math.round(t.conditions.waterTempF), costMin: cost } });
  },
  clearPoint: () => set({ point: null }),

  setScreen: (screen) => set({ screen }),
  mutateSave: (fn) => {
    const save = structuredClone(get().save);
    fn(save);
    set({ save });
    writeSave(save);
  },
  persist: () => {
    const { save, tournament } = get();
    writeSave({ ...save, activeTournament: tournament ?? undefined });
  },
  selectLake: (id) => set({ selectedLake: id }),

  startTournament: (seed) => {
    const { save, selectedLake } = get();
    const tier = tierOfLake(selectedLake);
    const entry = PURSE[tier].entry;
    const t = createTournament({
      lakeId: selectedLake,
      tier,
      seed: seed ?? (Date.now() & 0x7fffffff),
      deck: save.deck,
      autoHookset: save.settings.autoHookset,
    });
    const next = structuredClone(save);
    next.player.cash = Math.max(0, next.player.cash - entry);
    next.activeTournament = t;
    writeSave(next);
    set({ save: next, tournament: t, screen: 'briefing', paused: false, lastResult: null });
  },
  resumeTournament: () => {
    const t = get().save.activeTournament;
    if (!t) return;
    set({ tournament: t, screen: t.phase === 'WeighIn' ? 'results' : 'game', paused: true });
  },
  abandonTournament: () => {
    const save = structuredClone(get().save);
    delete save.activeTournament;
    writeSave(save);
    set({ save, tournament: null, screen: 'hub', hud: null });
  },
  setHud: (hud) => set({ hud }),
  notify: (n) => {
    const id = noticeId++;
    let list = get().notices;
    if (n.kind === 'ticker') {
      // A stale feed is worse than a short one: keep only the newest few.
      const tickers = list.filter((x) => x.kind === 'ticker');
      if (tickers.length >= MAX_TICKER_QUEUE) list = list.filter((x) => x !== tickers[0]);
    } else list = list.filter((x) => x.kind !== n.kind);
    set({ notices: [...list, { ...n, id }] });
    const ms = NOTICE_MS[n.kind];
    if (ms) setTimeout(() => get().dismissNotice(id), ms);
  },
  dismissNotice: (id) => set({ notices: get().notices.filter((x) => x.id !== id) }),
  setPaused: (paused) => {
    set({ paused });
    if (paused) get().persist();
  },
  cull: (releaseIndex) => {
    const t = get().tournament;
    if (!t) return;
    resolveCull(t, releaseIndex);
    continueAfterLanded(t);
    get().persist();
  },
  continueFishing: () => {
    const t = get().tournament;
    if (!t || t.phase !== 'Landed') return;
    continueAfterLanded(t);
    get().persist();
  },
  selectRod: (i) => {
    const t = get().tournament;
    if (t) switchRod(t, i);
  },
  finishDay: () => {
    get().persist();
    // In-game notices have done their job; the weigh-in has its own show.
    set({ screen: 'results', notices: [] });
  },
  nextDay: () => {
    const t = get().tournament;
    if (!t) return;
    startNextDay(t);
    get().persist();
    // Each morning gets a briefing: new conditions, a new plan, a chance to re-rig.
    set({ screen: 'briefing', paused: false });
  },
  rerigBeforeLaunch: () => {
    const t = get().tournament;
    if (!canRerig(t)) return;
    t!.deck = structuredClone(get().save.deck);
    // Elite gets no plan, so the day doesn't start on the plan's rod either.
    if (adviceFor(t!.tier).plan !== 'scouting') t!.activeRod = plannedRod(t!);
    get().persist();
  },
  launchDay: () => {
    const t = get().tournament;
    // Nothing has happened on the water yet: tie on what the briefing's plan says to throw first.
    if (t && canRerig(t) && adviceFor(t.tier).plan !== 'scouting') {
      t.activeRod = plannedRod(t);
      get().persist();
    }
    set({ screen: 'game' });
  },
  completeTournament: () => {
    const t = get().tournament;
    if (!t || !isTournamentOver(t)) return;
    const save = structuredClone(get().save);
    const res = applyResult(save, t);
    delete save.activeTournament;
    writeSave(save);
    set({ save, tournament: null, hud: null, lastResult: res, screen: 'hub' });
  },
}));

export function buildHud(t: TournamentState, nearWaypoint: Hud['nearWaypoint'], nav: NavHud | null = null, inRange = false): Hud {
  const lake = LAKES[t.lakeId];
  const st = standings(t, false);
  const placeIdx = st.findIndex((x) => x.isPlayer);
  const fight = t.fight;
  let meter = 0;
  if (t.present) for (const f of t.fish) if (!f.caught && f.interest > meter) meter = f.interest;
  return {
    phase: t.phase,
    clock: formatClock(t.clockMin),
    clockMin: t.clockMin,
    day: t.day,
    totalDays: t.totalDays,
    livewell: [...t.livewell],
    bag: bagWeight(t.livewell),
    place: placeIdx + 1,
    fieldSize: st.length,
    leaders: st.slice(0, 5).map((x) => ({ name: x.name, total: x.total, isPlayer: x.isPlayer })),
    activeRod: t.activeRod,
    rodLabels: t.deck.map((d) => LURES[d.lureId].short),
    canFish: t.phase === 'Navigate' && t.boat.speed <= 6,
    motor: t.boat.motor,
    castCharging: !!t.cast?.powerCharging,
    castFlying: !!t.cast?.flying,
    tension: fight?.tension ?? 0,
    stamina: fight?.stamina ?? 1,
    fishName: fight?.revealed ? SPECIES[fight.species].name : fight ? 'Unknown fish' : null,
    jumping: !!fight && fight.jumpT > 0 && !fight.jumpBowed,
    meter,
    match: t.present?.match ?? 0,
    lureDepth: t.present?.lureDepthFt ?? 0,
    nearWaypoint,
    pendingCull: t.pendingCull,
    lastLanded: t.lastLanded,
    proPick: !adviceFor(t.tier).proChip ? -1 : t.phase === 'Navigate' || t.phase === 'Cast' ? proPickNow(lake, t.conditions, t.deck, t.clockMin, t.boat.pos, planFor(t)) : t.activeRod,
    nav: t.phase === 'Navigate' ? nav : null,
    inRange: t.phase === 'Navigate' && inRange,
    hook: t.present?.strikingFishId == null ? 'none' : t.present.strikeT < biteAtSec(LURES[t.deck[t.activeRod].lureId]) ? 'wait' : 'set',
    checkIn: checkInHud(t),
  };
}

export function checkInHud(t: TournamentState): CheckInHud {
  const grid = getLakeGrid(LAKES[t.lakeId]);
  const etaMin = etaHomeMin(grid, t.boat.pos);
  return {
    etaMin,
    leaveBy: formatClock(Math.max(TUNING.clock.dayStartMin, leaveByMin(etaMin))),
    headIn: t.timeWarned || t.clockMin >= TUNING.clock.dayEndMin,
    late: t.clockMin >= TUNING.clock.dayEndMin,
    lateMin: lateMinutes(t.clockMin),
    atLaunch: atLaunch(grid, t.boat.pos),
    can: canCheckIn(t),
  };
}

export const lakeName = (id: string) => LAKES[id]?.name ?? id;
