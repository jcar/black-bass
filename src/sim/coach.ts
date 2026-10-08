// Live coach and post-day debrief. Pure and deterministic: reads the tournament state and its events,
// never changes them. Every tip names a rule the sim actually applies (presentation.ts, attraction.ts,
// tournament.ts), so "hardcore" stays fair: you're told why a fish didn't eat, not given fish.
import { LAKES } from '../data/lakes';
import { LURES } from '../data/lures';
import { RODS, rodPowerOk } from '../data/rods';
import { SPECIES } from '../data/species';
import { TUNING } from '../data/tuning';
import { advisorRoute, APPROACH_TIP, techniqueTip } from './advisor';
import type { GamePhase, HookMiss, RodSetup, TournamentEvent, TournamentState, Vec2 } from './types';

export interface CoachTip {
  id: string;
  title: string;
  text: string;
}

export interface DayStats {
  casts: number;
  arrivals: number;
  spookedArrivals: number;
  crashes: number;
  /** Casts made with no catchable bass within reach of the boat. */
  fishlessCasts: number;
  /** Casts that drew followers but no strike. */
  followNoStrike: number;
  strikes: number;
  /** Per lure: casts and summed end-of-cast retrieve match. */
  match: Record<string, { n: number; sum: number }>;
  /** Strikes that didn't become hooked fish, by why (presentation.ts hookset). */
  missed?: Record<HookMiss, number>;
}

export interface CoachState {
  stats: DayStats;
  lastTipAt: number;
  tipAt: Record<string, number>;
  tipCount: Record<string, number>;
  phase: GamePhase | null;
  /** Current cast. */
  castFollowers: number;
  castStruck: boolean;
  lowMatchSec: number;
  earlyReelSec: number;
  lastMatch: number;
  /** Current stop. */
  stopCasts: number;
  stopFishless: number;
  stopFollowNoStrike: number;
  visited: Vec2[];
}

/** Min real seconds between any two tips, and before the same tip repeats; max repeats per day. */
const GAP_SEC = 20;
const REPEAT_SEC = 90;
const MAX_PER_DAY = 2;
/** Fish within this range of the boat are "around the spot" (casts land up to ~30 m out). */
const REACH_M = 40;

export function newCoach(): CoachState {
  return {
    stats: { casts: 0, arrivals: 0, spookedArrivals: 0, crashes: 0, fishlessCasts: 0, followNoStrike: 0, strikes: 0, match: {}, missed: { early: 0, late: 0, noHook: 0 } },
    lastTipAt: -Infinity,
    tipAt: {},
    tipCount: {},
    phase: null,
    castFollowers: 0,
    castStruck: false,
    lowMatchSec: 0,
    earlyReelSec: 0,
    lastMatch: 1,
    stopCasts: 0,
    stopFishless: 0,
    stopFollowNoStrike: 0,
    visited: [],
  };
}

/** Why the hook didn't stick, from the same rules hookUpChance applies. */
export function noHookReason(rig: RodSetup): string {
  const lure = LURES[rig.lureId];
  const rod = RODS[rig.rodId];
  if (!rodPowerOk(rod, lure)) return `The ${lure.name} needs a ${lure.rodPower} rod or heavier to drive the hook; a ${rod.power} bends instead.`;
  if (lure.hookRate && lure.hookRate < 1) return `${lure.name}s miss a share of strikes however you set. Keep at it, on braid and a heavy rod.`;
  if (!lure.treble && rig.line.type !== 'braid') return `${rig.line.type === 'mono' ? 'Mono' : 'Fluoro'} stretches: on a long cast a single hook doesn't get driven home. Shorter casts, braid, or less stretchy line hook more.`;
  if (lure.treble && rig.line.type === 'braid') return 'Trebles on braid have no give: they tear out. Mono or fluoro (or a braid-to-fluoro leader) keeps them pinned.';
  return 'Some strikes just miss the hook. Set on the thump, not before.';
}

/** The coach's explanation for a missed hookset. */
export function missTip(why: HookMiss, topwater: boolean, rig: RodSetup): CoachTip {
  if (why === 'early')
    return topwater
      ? { id: 'miss-early-top', title: 'Too early: wait to feel the weight on topwater', text: "The blow-up isn't the bite. Let the fish turn down with it, feel the weight (the thump), then set: H or HOOK." }
      : { id: 'miss-early', title: 'Too early', text: "You set while the fish was still coming. Wait for the thump (HOOK glows), then set: H or HOOK." };
  if (why === 'late')
    return { id: 'miss-late', title: 'Too late', text: 'Bass spit a hard bait in under a second (soft plastics a little later). Set as soon as you feel the thump: H or HOOK.' };
  return { id: 'miss-nohook', title: "The hook didn't stick", text: noHookReason(rig) };
}

function bassNear(t: TournamentState, at: Vec2, r: number): { n: number; spooked: number } {
  let n = 0;
  let spooked = 0;
  for (const f of t.fish) {
    if (f.caught || !SPECIES[f.species].isBass) continue;
    if (Math.hypot(f.pos.x - at.x, f.pos.y - at.y) > r) continue;
    n++;
    if (f.spookUntil > t.clockMin) spooked++;
  }
  return { n, spooked };
}

/**
 * Advance the coach one frame. `events` are this frame's sim events; `now` is real seconds.
 * Returns a tip to show, or null. Stats are always tracked, tips only when `enabled`.
 */
export function coachStep(c: CoachState, t: TournamentState, events: TournamentEvent[], now: number, dt: number, enabled = true): CoachTip | null {
  const rig = t.deck[t.activeRod];
  const lure = rig ? LURES[rig.lureId] : null;
  const candidates: CoachTip[] = [];
  const prev = c.phase;
  c.phase = t.phase;

  // Arriving at a stop: the first Cast phase after navigating.
  if (prev === 'Navigate' && t.phase === 'Cast') {
    c.stats.arrivals++;
    c.stopCasts = 0;
    c.stopFishless = 0;
    c.stopFollowNoStrike = 0;
    c.visited.push({ ...t.boat.pos });
    const near = bassNear(t, t.boat.pos, 30);
    if (near.n >= 2 && near.spooked / near.n >= 0.4) {
      c.stats.spookedArrivals++;
      candidates.push({ id: 'spooked', title: 'You spooked them coming in', text: `${near.spooked} of ${near.n} bass here are spooked. ${APPROACH_TIP}` });
    }
  }

  for (const e of events) {
    if (e.type === 'crash') {
      c.stats.crashes++;
      candidates.push({ id: 'crash', title: 'Cast hit the cover', text: `A lure landing on docks or wood spooks fish within ${TUNING.cast.crashSpookRadius} m. Aim at the edge: edge casts are rewarded.` });
    }
    if (e.type === 'strike') {
      c.castStruck = true;
      c.stats.strikes++;
    }
    if (e.type === 'missed' && e.data?.miss && rig) {
      const m = (c.stats.missed ??= { early: 0, late: 0, noHook: 0 });
      m[e.data.miss]++;
      candidates.push(missTip(e.data.miss, !!e.data.topwater, rig));
    }
    if (e.type === 'fouled' && lure)
      candidates.push({
        id: 'fouled',
        title: 'Grass on the hooks',
        text: `A treble bait in the grass comes back fouled and won't get bit. Twitch (T) to rip the ${lure.name} free: the rip is a reaction trigger. Weedless baits come through clean.`,
      });
  }

  if (t.phase === 'Present' && t.present && lure) {
    const p = t.present;
    if (prev !== 'Present') {
      c.castFollowers = 0;
      c.castStruck = false;
      c.lowMatchSec = 0;
      c.earlyReelSec = 0;
      c.stats.casts++;
      c.stopCasts++;
      const near = bassNear(t, t.boat.pos, REACH_M);
      if (near.n - near.spooked === 0) {
        c.stats.fishlessCasts++;
        c.stopFishless++;
      }
    }
    let followers = 0;
    for (const f of t.fish) if (!f.caught && f.interest >= TUNING.attraction.followAt) followers++;
    c.castFollowers = Math.max(c.castFollowers, followers);
    c.lastMatch = p.match;
    const speed = Math.hypot(p.lureVel.x, p.lureVel.y);
    const sinks = lure.motion === 'sinking';
    if (sinks && !p.onBottom && !p.held && p.t < 6 && speed > 0.15) c.earlyReelSec += dt;
    if (p.t > 1.5 && p.match < 0.45 && (!sinks || p.onBottom)) c.lowMatchSec += dt;
    if (c.earlyReelSec > 1.2) candidates.push({ id: 'bottom', title: 'Let it hit bottom first', text: `The ${lure.name} gets bit on the bottom. Watch the sonar depth and wait for it to touch down before you reel.` });
    if (c.lowMatchSec > 1.5) candidates.push({ id: `match-${lure.style}`, title: `Work the ${lure.name} right`, text: techniqueTip(lure.id, t.conditions.waterTempF) });
  }

  // End of a cast (back at the boat, or a fish ended it).
  if (prev === 'Present' && t.phase !== 'Present' && lure) {
    const m = (c.stats.match[lure.id] ??= { n: 0, sum: 0 });
    m.n++;
    m.sum += c.lastMatch;
    if (c.castFollowers > 0 && !c.castStruck) {
      c.stats.followNoStrike++;
      c.stopFollowNoStrike++;
      if (c.stopFollowNoStrike >= 2)
        candidates.push({
          id: 'followers',
          title: 'Followers, no bite',
          text: 'They see it and like it, but not enough. Get the depth right, work it cleaner, or try another rig: the Pro tag on the rod bar shows the best one for this water.',
        });
    }
    if (c.stopCasts >= 4 && c.stopFishless >= 3) {
      const lake = LAKES[t.lakeId];
      const next = advisorRoute(lake, t.conditions, rig).find((s) => Math.hypot(s.spot.x - t.boat.pos.x, s.spot.y - t.boat.pos.y) > 150 && c.visited.every((v) => Math.hypot(v.x - s.spot.x, v.y - s.spot.y) > 100));
      candidates.push({ id: 'fishless', title: 'No bass here', text: `Nothing on the sonar within casting range. Move${next ? `: try ${next.spot.name} (${next.why})` : ' to structure'}.` });
    }
  }

  if (!enabled || !candidates.length || now - c.lastTipAt < GAP_SEC) return null;
  for (const tip of candidates) {
    if ((c.tipCount[tip.id] ?? 0) >= MAX_PER_DAY || now - (c.tipAt[tip.id] ?? -Infinity) < REPEAT_SEC) continue;
    c.tipAt[tip.id] = now;
    c.tipCount[tip.id] = (c.tipCount[tip.id] ?? 0) + 1;
    c.lastTipAt = now;
    return tip;
  }
  return null;
}

/** Three things to work on, from the day's stats, most costly first. */
export function debrief(s: DayStats, waterTempF: number): string[] {
  const out: { cost: number; text: string }[] = [];
  if (s.arrivals >= 2 && s.spookedArrivals / s.arrivals >= 0.25)
    out.push({ cost: (s.spookedArrivals / s.arrivals) * 10, text: `${s.spookedArrivals} of ${s.arrivals} stops started with spooked fish. ${APPROACH_TIP}` });
  if (s.crashes >= 2) out.push({ cost: s.crashes * 0.8, text: `${s.crashes} casts crashed into cover, spooking the fish around it. Aim for the edge of docks and wood.` });
  if (s.casts >= 6 && s.fishlessCasts / s.casts >= 0.3)
    out.push({ cost: (s.fishlessCasts / s.casts) * 8, text: `${Math.round((s.fishlessCasts / s.casts) * 100)}% of your casts were in water with no bass in range. The scouting report's stops hold fish.` });
  for (const [id, m] of Object.entries(s.match)) {
    if (m.n < 4) continue;
    const avg = m.sum / m.n;
    if (avg < 0.6) out.push({ cost: (0.8 - avg) * 12, text: `Your ${LURES[id].name} retrieve rated ${Math.round(avg * 100)}% (a pro gets ~80%+). ${techniqueTip(id, waterTempF)}` });
  }
  const missed = s.missed ? s.missed.early + s.missed.late + s.missed.noHook : 0;
  if (missed >= 3 && s.missed) {
    const m = s.missed;
    const worst = m.early >= m.late && m.early >= m.noHook ? 'set too early (on topwater, wait for the weight)' : m.late >= m.noHook ? 'set too late (set on the thump)' : "set on time but the hook didn't stick (check rod power and line stretch)";
    out.push({ cost: missed * 0.9, text: `${missed} strikes missed at the hookset, most ${worst}.` });
  }
  if (s.followNoStrike >= 4) out.push({ cost: s.followNoStrike * 0.4, text: `${s.followNoStrike} casts drew followers that didn't eat: close, but not enough. Match the fish's depth or switch to the Pro pick.` });
  out.sort((a, b) => b.cost - a.cost);
  if (!out.length) return [s.strikes > 0 ? 'Clean day: good approaches, good retrieves. More bites now come from better water and timing: check the scouting report.' : 'No obvious mistakes, but no bites: try the stops and rigs in the scouting report.'];
  return out.slice(0, 3).map((x) => x.text);
}
