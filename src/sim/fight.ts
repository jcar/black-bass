import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { activeTackle, dist, emit, type SimCtx } from './context';
import { coverAt, isWater } from './lake';
import { landFish } from './livewell';
import { transition } from './machine';
import type { FightState, FishEntity, InputFrame, TournamentState, Vec2 } from './types';

const F = TUNING.fight;

export function newFightState(s: TournamentState, ctx: SimCtx, f: FishEntity, at: Vec2): FightState {
  const away = Math.atan2(at.y - s.boat.pos.y, at.x - s.boat.pos.x);
  return {
    fishId: f.id,
    species: f.species,
    weightLb: f.weightLb,
    pos: { ...at },
    heading: away + ctx.rng.normal(0, 0.8),
    speed: 0,
    lineOut: dist(at, s.boat.pos) + 0.5,
    stamina: 1,
    tensionLb: 0,
    tension: 0,
    burstT: ctx.rng.range(0.8, 1.6), // the initial run after the hookset
    nextBurstIn: ctx.rng.range(1.5, 3),
    jumpT: 0,
    jumpBowed: false,
    jumps: 0,
    revealed: false,
    t: 0,
    rodSide: 0,
    hook: { x: at.x, y: at.y, depthFt: f.depthFt },
  };
}

export function breakingStrengthLb(testLb: number): number {
  return testLb * F.knotStrength;
}

function loseFish(s: TournamentState, type: 'snap' | 'thrown' | 'popped', text: string) {
  const fight = s.fight;
  if (fight) {
    const f = s.fish[fight.fishId];
    f.interest = 0;
    f.spookUntil = s.clockMin + 30;
    if (type !== 'popped') s.stats.lost++;
    emit(s, type, text, fight.pos);
  }
  s.fight = null;
  transition(s, 'Cast');
}

export function stepFight(s: TournamentState, ctx: SimCtx, input: InputFrame, dt: number): void {
  const fight = s.fight;
  if (!fight) return;
  const { rng, grid } = ctx;
  const { rod, lure, setup } = activeTackle(s);
  const sp = SPECIES[fight.species];
  const w = fight.weightLb;
  const stretch = F.stretch[setup.line.type];
  const breakLb = breakingStrengthLb(setup.line.testLb);
  fight.t += dt;

  // Cut bait: pop the hook to shake off a fish (handy for bycatch eating the clock).
  if (input.popTap) {
    s.clockMin += TUNING.clock.popAttemptMin;
    if (rng.chance(F.popChance)) {
      loseFish(s, 'popped', `Shook off the ${fight.revealed ? sp.name.toLowerCase() : 'fish'}.`);
      return;
    }
    emit(s, 'popFailed', 'Still hooked!');
  }

  const boat = s.boat.pos;
  let rel = { x: fight.pos.x - boat.x, y: fight.pos.y - boat.y };
  let D = Math.max(0.01, Math.hypot(rel.x, rel.y));
  let u = { x: rel.x / D, y: rel.y / D };
  // Screen-right in a view where "away from the boat" is up.
  const right = { x: -u.y, y: u.x };

  // --- Fish behaviour: bursts (runs) between cruising, bigger and fresher fish run harder ---
  // A beaten fish has nothing left: no new runs, a weak pull, and it comes to the boat quickly.
  const beat = fight.stamina <= F.beatStamina;
  fight.nextBurstIn -= dt;
  if (fight.burstT > 0) fight.burstT -= dt;
  else if (fight.nextBurstIn <= 0 && !beat) {
    fight.burstT = rng.range(0.7, 1.8) * (0.5 + fight.stamina);
    const awayAng = Math.atan2(u.y, u.x);
    fight.heading = awayAng + rng.normal(0, 1.0);
    fight.nextBurstIn = rng.range(1.5, 4.5) / (0.4 + fight.stamina);
  }
  const bursting = fight.burstT > 0;
  if (!bursting) fight.heading += rng.normal(0, 0.8) * dt;

  // Directional rod pull: pulling opposite the fish's swim direction turns its head.
  fight.rodSide = input.stick.x;
  const hv = { x: Math.cos(fight.heading), y: Math.sin(fight.heading) };
  const lateral = hv.x * right.x + hv.y * right.y; // + = fish swimming toward screen-right
  const opposing = Math.abs(input.stick.x) > 0.2 && input.stick.x * lateral < -0.05;
  const sameSide = Math.abs(input.stick.x) > 0.2 && input.stick.x * lateral > 0.05;
  if (opposing) {
    // Turn the heading toward the side the rod is pulling.
    const targetSide = input.stick.x > 0 ? right : { x: -right.x, y: -right.y };
    const targetAng = Math.atan2(targetSide.y - u.y * 0.5, targetSide.x - u.x * 0.5);
    let dAng = targetAng - fight.heading;
    dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
    fight.heading += Math.sign(dAng) * Math.min(Math.abs(dAng), F.turnRate * Math.abs(input.stick.x) * dt);
  }

  const speed = (bursting ? F.burstSpeed * (0.4 + 0.6 * fight.stamina) * (1 + w / 12) : F.cruiseSpeed * (0.5 + 0.5 * fight.stamina)) * sp.power * (beat ? F.beatSwimMult : 1);
  fight.speed = speed;
  let v = { x: Math.cos(fight.heading) * speed, y: Math.sin(fight.heading) * speed };
  const radialOut = v.x * u.x + v.y * u.y;
  const pullDir = 0.4 + (0.6 * Math.max(0, radialOut)) / Math.max(0.1, speed);
  const pullLb = w * sp.power * (bursting ? F.burstPullMult : F.sustainedPullMult) * (0.35 + 0.65 * fight.stamina) * pullDir * (beat ? F.beatPullMult : 1);

  // --- Player: reel winches the fish in, the thumb-brake locks the spool, idle lets it run ---
  const reeling = input.reel;
  const braking = input.brake && !reeling;
  let target: number;
  if (reeling) {
    const load = pullLb + F.rodLoadLb[rod.power] + w * F.dragThroughWaterMult;
    const dragLb = F.dragSetting * breakLb;
    const reelSpeed = F.reelSpeed * (beat ? F.beatReelMult : 1);
    if (load <= dragLb || input.brake) {
      // Under the drag (or the spool thumbed shut): every turn of the handle gains line.
      v = { x: v.x - u.x * reelSpeed, y: v.y - u.y * reelSpeed };
      target = load;
    } else {
      // The drag slips: the fish takes line instead of the tension climbing. The harder it
      // out-pulls the drag, the less the handle gains; a hard surge still overruns it a little.
      const gain = Math.max(0, 1 - (load - dragLb) / dragLb);
      v = { x: v.x - u.x * reelSpeed * gain, y: v.y - u.y * reelSpeed * gain };
      target = dragLb + (load - dragLb) * F.dragOverrun;
    }
  } else if (braking) {
    const out = v.x * u.x + v.y * u.y;
    if (out > 0) v = { x: v.x - u.x * out, y: v.y - u.y * out };
    target = radialOut > 0 ? pullLb * F.brakeTensionMult : w * 0.1 + pullLb * 0.3;
  } else {
    target = radialOut > 0 ? Math.min(pullLb, F.freeSpoolLb + 0.1 * w) : 0.1;
  }
  if (sameSide) target *= 1.1;

  // --- Jumps: tension spikes unless you bow to the fish (drop the rod tip) ---
  if (fight.jumpT > 0) {
    fight.jumpT -= dt;
    if (input.bowFlick) fight.jumpBowed = true;
    // A head-shake on a tight line spikes tension; on a slack line it mostly risks a thrown hook.
    const tight = reeling || braking ? 1 : 0.25;
    if (!fight.jumpBowed) target += F.jumpSpikeMult * w * tight * Math.max(0.2, 1 - stretch * 1.2) * (fight.jumpT > F.jumpWindowSec * 0.5 ? 1 : 0.6);
    if (fight.jumpT <= 0) {
      // Trebles on no-stretch braid tear out of the fish's mouth more easily.
      const tear = fight.tearOut ? TUNING.hookset.trebleBraidTearOut : 1;
      const chance = (fight.jumpBowed ? F.thrownChanceBowed : lure.treble ? F.thrownChanceTreble : F.thrownChanceUnbowed) * tear;
      if (rng.chance(chance)) {
        loseFish(s, 'thrown', 'It threw the hook on the jump!');
        return;
      }
    }
  } else if (fight.stamina > 0.15 && D < 40 && rng.chance(sp.jumpRate * dt * (0.5 + fight.stamina))) {
    fight.jumpT = F.jumpWindowSec;
    fight.jumpBowed = false;
    fight.jumps++;
    fight.revealed = true;
    emit(s, 'jump', 'Jump! Bow to the fish!', fight.pos);
  }

  // Line stretch acts as a shock absorber: mono smooths spikes, braid transmits them instantly.
  const tau = 0.05 + stretch * 0.6;
  fight.tensionLb += (target - fight.tensionLb) * Math.min(1, dt / tau);
  fight.tension = fight.tensionLb / breakLb;
  if (fight.tensionLb > breakLb) {
    loseFish(s, 'snap', `SNAP! The ${setup.line.testLb} lb line broke.`);
    return;
  }
  // Standing timber: a fish running through trunks under heavy pressure can wrap the line.
  // Heavier line and braid survive it; light fluoro in the timber is a gamble.
  if (fight.tension > F.wrapTension && coverAt(grid, fight.pos.x, fight.pos.y) === 'standing') {
    const lineFactor = (setup.line.type === 'braid' ? F.wrapBraidFactor : 1) * Math.min(1.5, 12 / setup.line.testLb);
    const p = F.wrapChancePerSec * ((fight.tension - F.wrapTension) / (1 - F.wrapTension)) * lineFactor * dt;
    if (rng.chance(p)) {
      loseFish(s, 'snap', 'Wrapped in the timber! The line frayed through.');
      return;
    }
  }

  // --- Move the fish (stays in water) ---
  const next = { x: fight.pos.x + v.x * dt, y: fight.pos.y + v.y * dt };
  if (isWater(grid, next.x, next.y)) fight.pos = next;
  else fight.heading += Math.PI * 0.6;
  rel = { x: fight.pos.x - boat.x, y: fight.pos.y - boat.y };
  D = Math.hypot(rel.x, rel.y);
  u = { x: rel.x / Math.max(0.01, D), y: rel.y / Math.max(0.01, D) };
  if (reeling) fight.lineOut = D;
  else if (braking) fight.lineOut = Math.max(D, Math.min(fight.lineOut, D));
  else fight.lineOut = Math.max(fight.lineOut, D);
  if (fight.lineOut > F.maxLineOutM) {
    loseFish(s, 'snap', 'Spooled! The fish ran off all your line.');
    return;
  }

  // --- Stamina ---
  const drain =
    F.staminaBaseDrain +
    F.staminaTensionDrain * Math.min(2, fight.tensionLb / w) +
    (braking ? F.staminaBrakeDrain : 0) +
    (opposing ? F.staminaRodTurnDrain * Math.abs(input.stick.x) : 0) +
    (bursting ? F.staminaBurstDrain : 0);
  fight.stamina -= (drain / (0.6 + w / 4)) * dt;
  if (fight.tensionLb < 0.5 && !bursting) fight.stamina += F.staminaRecover * dt;
  fight.stamina = Math.max(0, Math.min(1, fight.stamina));

  if (D < F.revealDistM) fight.revealed = true;

  if (D < F.landDistM) {
    if (fight.stamina <= F.landStaminaMax) {
      landFish(s, s.fish[fight.fishId]);
      return;
    }
    // Green fish at the boat surges away.
    fight.burstT = 1.0;
    fight.heading = Math.atan2(u.y, u.x) + rng.normal(0, 0.6);
  }
}
