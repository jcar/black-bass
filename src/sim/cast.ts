import type { LureDef } from '../data/lures';
import type { RodDef } from '../data/rods';
import { TUNING } from '../data/tuning';
import { activeTackle, dist, emit, type SimCtx } from './context';
import { newPresentState } from './presentation';
import { coverAt, HARD_COVER, isWater, nearCover } from './lake';
import { transition } from './machine';
import type { CastState, Conditions, InputFrame, Line, TournamentState } from './types';

const C = TUNING.cast;

/** Max cast distance (m): driven by lure weight, rod fit, line and wind. */
export function maxCastDistance(lure: LureDef, rod: RodDef, line: Line, c: Conditions, castDir: number): number {
  let d = C.baseDistM + C.distPerSqrtOz * Math.sqrt(lure.weightOz);
  if (lure.weightOz < rod.lureOz[0] || lure.weightOz > rod.lureOz[1]) d *= C.rodMismatchPenalty;
  if (line.type === 'braid') d *= C.braidBonus;
  if (line.type === 'mono') d *= C.monoPenalty;
  if (line.testLb <= 8 && line.type !== 'braid') d *= C.lightLineBonus;
  if (line.testLb >= 17 && line.type !== 'braid') d *= C.heavyLinePenalty;
  const windAlong = Math.cos(castDir - c.windDir);
  d *= 1 + C.windEffectPer15Mph * windAlong * (c.windMph / 15);
  return d;
}

export function newCastState(s: TournamentState): CastState {
  return {
    aimAngle: s.lastAimAngle,
    powerCharging: false,
    power: 0,
    powerDir: 1,
    flying: false,
    flightT: 0,
    flightDuration: 0,
    origin: { ...s.boat.pos },
    target: { ...s.boat.pos },
    lurePos: { ...s.boat.pos },
    lureHeight: 0,
    braked: false,
  };
}

/** Power bar shape: eased so the top of the bar is a narrow sweet spot. */
export const powerToDistanceFrac = (p: number) => 0.15 + 0.85 * Math.sin((p * Math.PI) / 2);

export function stepCast(s: TournamentState, ctx: SimCtx, input: InputFrame, dt: number): void {
  if (!s.cast) s.cast = newCastState(s);
  const cs = s.cast;

  if (!cs.flying) {
    if (input.moveOn) {
      s.cast = null;
      transition(s, 'Navigate');
      return;
    }
    cs.aimAngle = Math.max(-C.aimLimit, Math.min(C.aimLimit, cs.aimAngle + input.stick.x * C.aimRate * dt));
    if (cs.powerCharging) {
      cs.power += cs.powerDir * C.powerCyclesPerSec * 2 * dt;
      if (cs.power >= 1) {
        cs.power = 1;
        cs.powerDir = -1;
      } else if (cs.power <= 0) {
        cs.power = 0;
        cs.powerDir = 1;
      }
    }
    if (input.castTap) {
      if (!cs.powerCharging) {
        cs.powerCharging = true;
        cs.power = 0;
        cs.powerDir = 1;
      } else {
        launch(s, cs);
      }
    }
    return;
  }

  // In flight. Thumbing the spool (BRAKE) stops the line: the lure drops straight down.
  cs.flightT += dt;
  const f = Math.min(1, cs.flightT / cs.flightDuration);
  if (!cs.braked) {
    cs.lurePos = { x: cs.origin.x + (cs.target.x - cs.origin.x) * f, y: cs.origin.y + (cs.target.y - cs.origin.y) * f };
    const apex = Math.max(2, dist(cs.origin, cs.target) * 0.18);
    cs.lureHeight = 4 * apex * f * (1 - f);
    if (input.brake && f < 0.98) {
      cs.braked = true;
      cs.target = { ...cs.lurePos };
      // Remaining fall time from the current height.
      cs.flightDuration = cs.flightT + Math.min(0.45, Math.sqrt((2 * cs.lureHeight) / 9.8));
    }
  } else {
    const remain = Math.max(0.0001, cs.flightDuration - cs.flightT);
    cs.lureHeight = Math.max(0, cs.lureHeight - (cs.lureHeight / remain) * dt);
  }
  if (cs.flightT >= cs.flightDuration) land(s, ctx, cs);
}

function launch(s: TournamentState, cs: CastState) {
  const { lure, rod, setup } = activeTackle(s);
  const dir = s.boat.heading + cs.aimAngle;
  const d = maxCastDistance(lure, rod, setup.line, s.conditions, dir) * powerToDistanceFrac(cs.power);
  cs.origin = { ...s.boat.pos };
  cs.target = { x: s.boat.pos.x + Math.cos(dir) * d, y: s.boat.pos.y + Math.sin(dir) * d };
  cs.flying = true;
  cs.powerCharging = false;
  cs.flightT = 0;
  cs.flightDuration = C.flightBaseSec + d * C.flightSecPerM;
  cs.braked = false;
  s.stats.casts++;
}

function land(s: TournamentState, ctx: SimCtx, cs: CastState) {
  const { grid } = ctx;
  let at = { ...cs.target };
  cs.lureHeight = 0;

  if (!isWater(grid, at.x, at.y)) {
    cs.result = 'shore';
    s.clockMin += TUNING.clock.shoreSnagMin;
    emit(s, 'shore', 'Snagged on shore! Lost a few minutes.', at);
    s.cast = newCastState(s);
    s.cast.aimAngle = cs.aimAngle;
    return;
  }

  const cov = coverAt(grid, at.x, at.y);
  if (HARD_COVER.has(cov)) {
    cs.result = 'crash';
    // Fish under the cover scatter. The lure bounces back off the edge toward the boat.
    for (const f of s.fish) {
      if (!f.caught && dist(f.pos, at) < C.crashSpookRadius) {
        f.spookUntil = s.clockMin + C.crashSpookMin;
        f.interest = 0;
      }
    }
    const toBoat = Math.atan2(s.boat.pos.y - at.y, s.boat.pos.x - at.x);
    for (let k = 0; k < 20 && HARD_COVER.has(coverAt(grid, at.x, at.y)); k++) {
      at = { x: at.x + Math.cos(toBoat) * 2, y: at.y + Math.sin(toBoat) * 2 };
    }
    emit(s, 'crash', `Crashed into the ${cov}! Fish spooked.`, at);
  } else if (nearCover(grid, at.x, at.y, 8) !== 'none' || cov !== 'none') {
    cs.result = 'edge';
    emit(s, 'edge', 'Right on the edge!', at);
  } else {
    cs.result = 'water';
    emit(s, 'splash', undefined, at);
  }

  s.present = newPresentState(at, cs.result === 'edge');
  s.cast = null;
  transition(s, 'Present');
}
