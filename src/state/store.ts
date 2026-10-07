import { create } from 'zustand';
import { LAKES } from '../data/lakes';
import { PURSE } from '../data/lakes';
import { LURES } from '../data/lures';
import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { dayPlan, proPickNow, windowAt, type WindowPlan } from '../sim/advisor';
import { formatClock } from '../sim/conditions';
import { bagWeight, resolveCull, continueAfterLanded } from '../sim/livewell';
import { createTournament, isTournamentOver, standings, startNextDay, switchRod } from '../sim/tournament';
import type { CaughtFish, GamePhase, TournamentState } from '../sim/types';
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
  /** Advisor's rig for right now: the day plan's, unless the water here clearly suits another (deck index). */
  proPick: number;
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
  lastResult: { result: TournamentResult; promoted: string | null } | null;

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
  lastResult: null,

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
    t!.activeRod = plannedRod(t!);
    get().persist();
  },
  launchDay: () => {
    const t = get().tournament;
    // Nothing has happened on the water yet: tie on what the briefing's plan says to throw first.
    if (t && canRerig(t)) {
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

export function buildHud(t: TournamentState, nearWaypoint: Hud['nearWaypoint']): Hud {
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
    proPick: t.phase === 'Navigate' || t.phase === 'Cast' ? proPickNow(lake, t.conditions, t.deck, t.clockMin, t.boat.pos, planFor(t)) : t.activeRod,
  };
}

export const lakeName = (id: string) => LAKES[id]?.name ?? id;
