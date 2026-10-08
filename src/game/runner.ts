import { LAKES } from '../data/lakes';
import { dragTick, followCue, playEvent, playUi } from '../audio/sound';
import { GameRenderer } from '../render/GameRenderer';
import { getLakeGrid } from '../sim/lake';
import { advisorRoute } from '../sim/advisor';
import { coachStep, debrief, newCoach } from '../sim/coach';
import { bearingTo, castRangeM, compassPoint, distanceM, markVisited, navCue, nearestInRange, nextStop, relativeBearing, steerPoint, stumpsOnRoute, waterPath, type NavStop } from '../sim/nav';
import { isKeeper } from '../sim/livewell';
import { TUNING } from '../data/tuning';
import { adviceFor } from '../sim/tierAdvice';
import { appendLog, logEntry } from '../state/logbook';
import { vibrate } from '../ui/kit/haptics';
import type { Vec2 } from '../sim/types';
import { drainEvents, stepTournament } from '../sim/tournament';
import type { GamePhase, TournamentEvent, TournamentState } from '../sim/types';
import { lbOzText } from '../sim/format';
import { buildHud, useStore, type NavHud, type Notice } from '../state/store';
import { inputHub } from './input';

const STEP = 1 / 60;
const MAX_STEPS = 5;
const HUD_INTERVAL = 0.1;
const AUTOSAVE_INTERVAL = 20;

/** Seconds the "That's time" banner holds before the broadcast wipes to the weigh-in. */
const TIME_HOLD = 2.4;
/** Real seconds between "you hit the bank" notices (the bump sound and shake play every time). */
const BANK_NOTICE_GAP = 15;
/** Real seconds in which further bank contacts are the same bump. */
const BANK_DEBOUNCE = 0.8;
/** Re-plan the water route to the destination after the boat moves this far (m) or this long (s). */
const REPATH_M = 15;
const REPATH_SEC = 1.5;

/**
 * Sim event -> how the player hears about it. Most events already have a home on screen (the
 * fight panel, the catch card, the bow prompt), so they get sound only; the rest are routed by
 * urgency to a banner, the scorebug strip, the ticker, or a callout at the lure.
 */
function noticeFor(e: TournamentEvent): Omit<Notice, 'id'> | null {
  switch (e.type) {
    case 'snap':
      if (e.text?.startsWith('Wrapped')) return { kind: 'banner', title: 'Wrapped up', sub: 'The line frayed through on a trunk', tone: 'bad' };
      if (e.text?.startsWith('Spooled')) return { kind: 'banner', title: 'Spooled', sub: 'It ran off all your line', tone: 'bad' };
      return { kind: 'banner', title: 'Line break', sub: e.text?.replace(/^SNAP! /, ''), tone: 'bad' };
    case 'thrown':
      return { kind: 'banner', title: 'Thrown', sub: 'It threw the hook on the jump', tone: 'bad' };
    case 'stump':
      return { kind: 'banner', title: 'Stump!', sub: e.text?.replace(/^Hit a stump! /, ''), tone: 'bad' };
    case 'dayOver': {
      const late = e.data?.lateMin ?? 0;
      if (late > TUNING.checkIn.lateMaxMin) return { kind: 'banner', title: 'Too late', sub: `${late} min late: today's catch doesn't count`, tone: 'bad' };
      if (late > 0) return { kind: 'banner', title: `Late: -${late * TUNING.checkIn.latePenaltyLbPerMin} lb`, sub: `Checked in ${late} min late`, tone: 'bad' };
      return { kind: 'banner', title: 'Checked in', sub: 'Head to the weigh-in', tone: 'gold' };
    }
    case 'timeWarning':
      return { kind: 'bug', title: `Head in: ${e.data?.etaMin ?? '?'} min run to the launch`, tone: 'bad' };
    case 'late':
      return { kind: 'banner', title: 'Check-in time', sub: `Get to the launch: ${TUNING.checkIn.latePenaltyLbPerMin} lb a minute late`, tone: 'bad' };
    case 'fishDied':
      return { kind: 'banner', title: 'Fish died', sub: `${TUNING.livewell.deadPenaltyLb * 16} oz penalty at the scales, and it can't be culled`, tone: 'bad' };
    case 'message':
      return e.text ? { kind: 'ticker', title: e.text, tone: 'info' } : null;
    case 'popped':
      return { kind: 'bug', title: 'Shook it off', tone: 'info' };
    case 'missed':
      return { kind: 'bug', title: e.text ?? 'Missed', tone: 'bad' };
    case 'popFailed':
      return { kind: 'bug', title: 'Still hooked', tone: 'info' };
    case 'playerPlace':
      return { kind: 'bug', title: e.text ?? '', tone: e.text?.startsWith('Out') || e.text?.startsWith('Below') ? 'bad' : 'good' };
    case 'leaderChange':
      return e.data?.name === 'You'
        ? { kind: 'bug', title: 'You take the lead', tone: 'gold' }
        : { kind: 'ticker', title: `${e.data?.name} takes the lead`, sub: e.data?.weightLb ? `${lbOzText(e.data.weightLb)} total` : undefined, tone: 'gold' };
    case 'rivalCatch':
      return {
        kind: 'ticker',
        title: `${e.data?.name} boats a ${lbOzText(e.data?.weightLb ?? 0)}`,
        sub: e.data?.place ? `Now #${e.data.place}` : undefined,
        tone: e.data?.big ? 'gold' : 'info',
      };
    default:
      return null;
  }
}

const CALLOUT: Partial<Record<TournamentEvent['type'], { text: string; color: number }>> = {
  edge: { text: 'EDGE', color: 0x5cf27a },
  crash: { text: 'CRASH', color: 0xff5d4d },
  shore: { text: 'SNAGGED', color: 0xff5d4d },
  bank: { text: 'BANK!', color: 0xff9a4d },
  bite: { text: 'HOOK HIM!', color: 0xffe066 },
  missed: { text: 'MISSED', color: 0xff5d4d },
  fouled: { text: 'GRASS', color: 0xffb347 },
};

/**
 * Fixed-timestep loop: the sim always advances in exact 1/60 s steps (deterministic), the
 * renderer draws once per display frame. Pauses when the app is backgrounded and snapshots
 * the tournament so an iOS app kill resumes exactly where the player was.
 */
export class GameRunner {
  renderer = new GameRenderer();
  private acc = 0;
  private hudT = 0;
  private saveT = 0;
  private detachKeys: (() => void) | null = null;
  private onVis = () => {
    if (document.visibilityState === 'hidden') useStore.getState().setPaused(true);
  };
  private onHide = () => useStore.getState().persist();
  private running = false;
  private initialized = false;
  private stopped = false;
  private timeUpAt: number | null = null;
  private coach = newCoach();
  private coachDay = -1;
  private realT = 0;
  private proKey = '';
  /** Today's PRO route for the rig in hand, the charted waypoints, and the stops fished so far. */
  private route: NavStop[] = [];
  private waypoints: NavStop[] = [];
  private visited = new Set<string>();
  private castsSeen = 0;
  private bankNoticeAt = -Infinity;
  private bankAt = -Infinity;
  /** Water route to the destination (re-planned as the boat moves). */
  private path: { key: string; from: Vec2; at: number; pts: Vec2[] } | null = null;
  private lastPhase: GamePhase | null = null;
  private touch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  async start(host: HTMLElement) {
    await this.renderer.init(host);
    this.initialized = true;
    // A fish starts following the lure: a soft cue (and a tick on touch devices), like the shadow you see.
    this.renderer.onFollow = () => {
      followCue();
      if (this.touch) vibrate();
    };
    // Unmounted while Pixi was still initialising (e.g. React StrictMode double-mount).
    if (this.stopped) {
      this.renderer.destroy();
      return;
    }
    this.detachKeys = inputHub.attachKeyboard(window);
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('pagehide', this.onHide);
    this.running = true;
    this.renderer.app.ticker.add((tk) => this.frame(Math.min(0.1, tk.deltaMS / 1000)));
  }

  private frame(dt: number) {
    if (!this.running) return;
    const store = useStore.getState();
    const t = store.tournament;
    if (!t) return;
    const grid = getLakeGrid(LAKES[t.lakeId]);
    this.renderer.debug = store.save.settings.debugMeter;

    const blocked = store.paused || store.mapOpen || store.screen !== 'game' || t.phase === 'WeighIn' || t.phase === 'Landed';
    // Settings can change mid-day (pause menu): the sim reads the auto-hookset choice from the state.
    t.autoHookset = store.save.settings.autoHookset;
    if (!blocked) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < MAX_STEPS) {
        stepTournament(t, inputHub.frame(t.phase), STEP);
        this.acc -= STEP;
        n++;
      }
      if (n === MAX_STEPS) this.acc = 0;
    } else {
      this.acc = 0;
    }

    const events = this.handleEvents(t);
    this.realT += dt;
    if (t.day !== this.coachDay) {
      this.coach = newCoach();
      this.coachDay = t.day;
      // A resumed day keeps the stops already fished.
      this.visited = new Set(t.navVisited?.day === t.day ? t.navVisited.ids : []);
      this.castsSeen = t.stats.casts;
      this.path = null;
      this.waypoints = LAKES[t.lakeId].waypoints.filter((w) => w.visible).map((w) => ({ id: w.id, name: w.name, x: w.x, y: w.y }));
      if (store.navTarget) store.setNavTarget(null);
      this.proKey = '';
    }
    // Mark the advisor's stops for the rig in hand (recomputed when the day or rod changes). How many
    // depends on the tier: the co-anglers get the whole milk run, pros find their own water.
    const stops = adviceFor(t.tier).proStops;
    const proKey = store.save.settings.coach && stops > 0 ? `${t.day}:${t.activeRod}:${t.deck[t.activeRod]?.lureId}:${stops}` : 'off';
    if (proKey !== this.proKey) {
      this.proKey = proKey;
      this.route = proKey === 'off' ? [] : advisorRoute(LAKES[t.lakeId], t.conditions, t.deck[t.activeRod], stops).map((s, i) => ({ id: s.spot.id, name: s.spot.name, x: s.spot.x, y: s.spot.y, pro: i + 1 }));
      this.renderer.setProStops(this.route);
      store.setNavRoute({ route: this.route, visited: [...this.visited] });
    }
    this.trackVisits(t);
    // Stopping to fish (FISH): the data for this point, where the tier gives it for free.
    if (t.phase !== this.lastPhase) {
      if (t.phase === 'Cast' && this.lastPhase === 'Navigate') store.checkPoint(false);
      else if (t.phase !== 'Cast' && store.point) store.clearPoint();
      this.lastPhase = t.phase;
    }
    const tip = coachStep(this.coach, t, events, this.realT, blocked ? 0 : dt, store.save.settings.coach);
    if (tip) store.notify({ kind: 'coach', title: tip.title, sub: tip.text, tone: 'info' });
    if (t.fight) dragTick(t.fight.tension, inputHub.reel, this.renderer.view.time);
    this.renderer.render(t, grid, dt);

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = HUD_INTERVAL;
      const nav = this.navHud(t);
      store.setHud(buildHud(t, this.nearWaypoint(t), nav.hud, nav.inRange));
    }
    this.saveT += dt;
    if (this.saveT > AUTOSAVE_INTERVAL) {
      this.saveT = 0;
      store.persist();
    }
    // Hold on the "That's time" banner, then hand over to the weigh-in.
    if (t.phase === 'WeighIn' && store.screen === 'game') {
      const now = this.renderer.view.time;
      if (this.timeUpAt === null) this.timeUpAt = now;
      else if (now - this.timeUpAt >= TIME_HOLD) {
        this.timeUpAt = null;
        store.setDebrief(debrief(this.coach.stats, t.conditions.waterTempF, t.checkIns?.[t.checkIns.length - 1]));
        store.finishDay();
      }
    }
  }

  private handleEvents(t: TournamentState) {
    const store = useStore.getState();
    const events = drainEvents(t);
    for (const e of events) {
      // A hit on plane can be followed by a second as the boat creeps the last metres in: one bump.
      if (e.type === 'bank') {
        if (this.realT - this.bankAt < BANK_DEBOUNCE) continue;
        this.bankAt = this.realT;
      }
      playEvent(e.type);
      const n = noticeFor(e);
      if (n) store.notify(n);
      if (e.type === 'rivalCatch' && e.data?.big) playUi('record');
      // The fish has it: a tick under the thumb is the cue to set the hook.
      if (e.type === 'bite' && this.touch) vibrate();
      const c = CALLOUT[e.type];
      if (c && e.at) this.renderer.callout(c.text, c.color, e.at);
      if ((e.type === 'landed' || e.type === 'cullNeeded') && t.lastLanded) this.logCatch(t);
      if (e.type === 'landed' || e.type === 'cullNeeded') store.persist();
      // Time to head in: the chip and the map point at the launch (drop any stop picked on the map).
      if (e.type === 'timeWarning' && store.navTarget) store.setNavTarget(null);
      if (e.type === 'bank') {
        this.renderer.shake();
        if (this.realT - this.bankNoticeAt > BANK_NOTICE_GAP) {
          this.bankNoticeAt = this.realT;
          store.notify({ kind: 'bug', title: 'On the bank: steer away from shore to back off', tone: 'bad' });
        }
      }
    }
    return events;
  }

  /** Every bass landed goes in the logbook (with the lure, line, conditions and where it bit). */
  private logCatch(t: TournamentState) {
    const c = t.lastLanded!;
    const e = logEntry(t, c, isKeeper(c, LAKES[t.lakeId]) && !c.released);
    if (e) useStore.getState().mutateSave((s) => void (s.logbook = appendLog(s.logbook, e)));
  }

  private castRange(t: TournamentState) {
    const rig = t.deck[t.activeRod];
    return rig ? castRangeM(rig, t.conditions) : 25;
  }

  /** A stop counts as fished once you make a cast within casting range of it. */
  private trackVisits(t: TournamentState) {
    if (t.stats.casts === this.castsSeen) return;
    this.castsSeen = t.stats.casts;
    const store = useStore.getState();
    const fresh = markVisited(this.visited, [...this.route, ...this.waypoints, ...(store.navTarget ? [store.navTarget] : [])], t.boat.pos, this.castRange(t));
    if (!fresh.length) return;
    t.navVisited = { day: t.day, ids: [...this.visited] };
    if (store.navTarget && this.visited.has(store.navTarget.id)) store.setNavTarget(null);
    store.setNavRoute({ route: this.route, visited: [...this.visited] });
  }

  /** The destination chip: where you're headed, how far, which way, and what to do about it. */
  private navHud(t: TournamentState): { hud: NavHud | null; inRange: boolean } {
    const target = useStore.getState().navTarget;
    // Check-in: once it's time to head in, the launch is the destination (unless you pick a stop on the map).
    const L = LAKES[t.lakeId].launch;
    const home = t.timeWarned || t.clockMin >= TUNING.clock.dayEndMin;
    const dest = target ?? (home ? { id: 'launch', name: L.name, x: L.x, y: L.y } : nextStop(this.route, this.visited));
    const range = this.castRange(t);
    const boat = t.boat;
    const grid = getLakeGrid(LAKES[t.lakeId]);
    // On the outboard the route keeps to the boat lanes through stump fields.
    const running = boat.motor === 'outboard';
    const key = dest ? `${t.lakeId}:${dest.id}:${running}` : '';
    const p = this.path;
    if (dest && (!p || p.key !== key || distanceM(p.from, boat.pos) > REPATH_M || this.realT - p.at > REPATH_SEC)) {
      this.path = { key, from: { ...boat.pos }, at: this.realT, pts: waterPath(grid, boat.pos, dest, running) };
      useStore.getState().setNavPath(this.path.pts);
    }
    const path = dest && this.path ? this.path.pts : [];
    this.renderer.setDestination(dest, range, this.visited, path);
    const inRange = !!nearestInRange(dest ? [dest, ...this.route, ...this.waypoints] : [...this.route, ...this.waypoints], boat.pos, range);
    if (!dest) return { hud: null, inRange };
    const d = distanceM(boat.pos, dest);
    // The arrow follows the water: round an island or a point rather than straight through it.
    const steer = path.length ? steerPoint(grid, boat.pos, path, running) : dest;
    const stumps = running && grid.def.stumpZones?.length ? stumpsOnRoute(grid, boat.pos, path, boat.heading) : null;
    return {
      hud: {
        name: dest.name,
        pro: dest.pro ?? null,
        distM: Math.round(d),
        rel: relativeBearing(boat.heading, boat.pos, steer),
        routed: steer !== path[path.length - 1] && steer !== dest,
        steerCompass: compassPoint(bearingTo(boat.pos, steer)),
        compass: compassPoint(bearingTo(boat.pos, dest)),
        cue: navCue(d, boat.motor, range, stumps),
        outboard: boat.motor === 'outboard',
        manual: !!target,
        home: dest.id === 'launch',
      },
      inRange,
    };
  }

  private nearWaypoint(t: TournamentState) {
    if (t.phase !== 'Navigate' && t.phase !== 'Cast') return null;
    for (const w of LAKES[t.lakeId].waypoints) {
      if (w.visible && Math.hypot(w.x - t.boat.pos.x, w.y - t.boat.pos.y) < 70) return { name: w.name, tip: w.tip };
    }
    return null;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.running = false;
    this.detachKeys?.();
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('pagehide', this.onHide);
    inputHub.reset();
    if (this.initialized) this.renderer.destroy();
  }
}
