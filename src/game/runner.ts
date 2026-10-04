import { LAKES } from '../data/lakes';
import { dragTick, playEvent } from '../audio/sound';
import { GameRenderer } from '../render/GameRenderer';
import { getLakeGrid } from '../sim/lake';
import { drainEvents, stepTournament } from '../sim/tournament';
import type { TournamentEvent, TournamentState } from '../sim/types';
import { buildHud, useStore, type Toast } from '../state/store';
import { inputHub } from './input';

const STEP = 1 / 60;
const MAX_STEPS = 5;
const HUD_INTERVAL = 0.1;
const AUTOSAVE_INTERVAL = 20;

const TOAST_TONE: Partial<Record<TournamentEvent['type'], Toast['tone']>> = {
  hooked: 'good',
  edge: 'good',
  landed: 'good',
  snap: 'bad',
  thrown: 'bad',
  crash: 'bad',
  shore: 'bad',
  timeWarning: 'bad',
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
        stepTournament(t, inputHub.frame(), STEP);
        this.acc -= STEP;
        n++;
      }
      if (n === MAX_STEPS) this.acc = 0;
    } else {
      this.acc = 0;
    }

    this.handleEvents(t);
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
    if (t.phase === 'WeighIn' && store.screen === 'game') store.finishDay();
  }

  private handleEvents(t: TournamentState) {
    const store = useStore.getState();
    for (const e of drainEvents(t)) {
      playEvent(e.type);
      if (e.text && e.type !== 'jump') store.toast(e.text, TOAST_TONE[e.type] ?? 'info');
      if (e.type === 'landed' || e.type === 'cullNeeded') store.persist();
    }
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
