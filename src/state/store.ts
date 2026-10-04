import { create } from 'zustand';
import { LAKES } from '../data/lakes';
import { PURSE } from '../data/lakes';
import { COLORS, LURES } from '../data/lures';
import { SPECIES } from '../data/species';
import { formatClock } from '../sim/conditions';
import { bagWeight, resolveCull, continueAfterLanded } from '../sim/livewell';
import { createTournament, isTournamentOver, standings, startNextDay, switchRod } from '../sim/tournament';
import type { CaughtFish, GamePhase, TournamentState } from '../sim/types';
import { applyResult, tierOfLake } from './career';
import type { TournamentResult } from './save';
import { loadSave, writeSave, type SaveData } from './save';

export type Screen = 'title' | 'hub' | 'shop' | 'deck' | 'briefing' | 'game' | 'results';

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
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

interface StoreState {
  save: SaveData;
  screen: Screen;
  selectedLake: string;
  tournament: TournamentState | null;
  hud: Hud | null;
  toasts: Toast[];
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
  toast: (text: string, tone?: Toast['tone']) => void;
  setPaused: (p: boolean) => void;
  cull: (releaseIndex: number) => void;
  continueFishing: () => void;
  selectRod: (i: number) => void;
  finishDay: () => void;
  nextDay: () => void;
  completeTournament: () => void;
}

let toastId = 1;

export const useStore = create<StoreState>((set, get) => ({
  save: loadSave(),
  screen: 'title',
  selectedLake: 'champlain',
  tournament: null,
  hud: null,
  toasts: [],
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
  toast: (text, tone = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), 2600);
  },
  setPaused: (paused) => {
    set({ paused });
    if (paused) get().persist();
  },
  cull: (releaseIndex) => {
    const t = get().tournament;
    if (!t) return;
    const released = resolveCull(t, releaseIndex);
    if (released) get().toast(`Released a ${released.weightLb.toFixed(2)} lb fish.`);
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
    if (t && switchRod(t, i)) {
      const d = t.deck[i];
      get().toast(`${LURES[d.lureId].name} (${COLORS[d.colorId].name})`);
    }
  },
  finishDay: () => {
    get().persist();
    set({ screen: 'results' });
  },
  nextDay: () => {
    const t = get().tournament;
    if (!t) return;
    startNextDay(t);
    get().persist();
    set({ screen: 'game', paused: false });
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
  };
}

export const lakeName = (id: string) => LAKES[id]?.name ?? id;
