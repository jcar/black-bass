import { LAKES } from '../data/lakes';
import { dragTick, playEvent, playUi } from '../audio/sound';
import { GameRenderer } from '../render/GameRenderer';
import { getLakeGrid } from '../sim/lake';
import { advisorRoute } from '../sim/advisor';
import { coachStep, debrief, newCoach } from '../sim/coach';
import { drainEvents, stepTournament } from '../sim/tournament';
import type { TournamentEvent, TournamentState } from '../sim/types';
import { lbOzText } from '../sim/format';
import { buildHud, useStore, type Notice } from '../state/store';
import { inputHub } from './input';

const STEP = 1 / 60;
const MAX_STEPS = 5;
const HUD_INTERVAL = 0.1;
const AUTOSAVE_INTERVAL = 20;

/** Seconds the "That's time" banner holds before the broadcast wipes to the weigh-in. */
const TIME_HOLD = 2.4;

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
    case 'dayOver':
      return { kind: 'banner', title: "That's time", sub: 'Head to the weigh-in', tone: 'gold' };
    case 'timeWarning':
      return { kind: 'bug', title: '30 min to weigh-in', tone: 'bad' };
    case 'popped':
      return { kind: 'bug', title: 'Shook it off', tone: 'info' };
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

  async start(host: HTMLElement) {
    await this.renderer.init(host);
    this.initialized = true;
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

    const blocked = store.paused || store.screen !== 'game' || t.phase === 'WeighIn' || t.phase === 'Landed';
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
    }
    // Mark the advisor's stops for the rig in hand (recomputed when the day or rod changes).
    const proKey = store.save.settings.coach ? `${t.day}:${t.activeRod}:${t.deck[t.activeRod]?.lureId}` : 'off';
    if (proKey !== this.proKey) {
      this.proKey = proKey;
      this.renderer.setProStops(proKey === 'off' ? [] : advisorRoute(LAKES[t.lakeId], t.conditions, t.deck[t.activeRod]).map((s) => s.spot));
    }
    const tip = coachStep(this.coach, t, events, this.realT, blocked ? 0 : dt, store.save.settings.coach);
    if (tip) store.notify({ kind: 'coach', title: tip.title, sub: tip.text, tone: 'info' });
    if (t.fight) dragTick(t.fight.tension, inputHub.reel, this.renderer.view.time);
    this.renderer.render(t, grid, dt);

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = HUD_INTERVAL;
      store.setHud(buildHud(t, this.nearWaypoint(t)));
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
        store.setDebrief(debrief(this.coach.stats, t.conditions.waterTempF));
        store.finishDay();
      }
    }
  }

  private handleEvents(t: TournamentState) {
    const store = useStore.getState();
    const events = drainEvents(t);
    for (const e of events) {
      playEvent(e.type);
      const n = noticeFor(e);
      if (n) store.notify(n);
      if (e.type === 'rivalCatch' && e.data?.big) playUi('record');
      const c = CALLOUT[e.type];
      if (c && e.at) this.renderer.callout(c.text, c.color, e.at);
      if (e.type === 'landed' || e.type === 'cullNeeded') store.persist();
    }
    return events;
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
