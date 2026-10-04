// Headless balance harness: a scripted bot fishes full tournament days and we compare its bags
// against the simulated field. Usage: npm run simulate -- [days=40] [lake=champlain] [tier=Amateur]
import { LAKES } from '../src/data/lakes';
import { LURES } from '../src/data/lures';
import { STARTER_RODS } from '../src/data/rods';
import { TUNING } from '../src/data/tuning';
import { lightLevel } from '../src/sim/conditions';
import { getLakeGrid, isWater } from '../src/sim/lake';
import { bagWeight, continueAfterLanded, keeperMinIn } from '../src/sim/livewell';
import { Rng } from '../src/sim/rng';
import { createTournament, drainEvents, standings, stepTournament } from '../src/sim/tournament';
import { emptyInput, type RodSetup, type Tier, type TournamentState } from '../src/sim/types';

const DT = 1 / 60;

export function botDeck(lakeId = 'champlain'): RodSetup[] {
  // Timber lakes: a pro rigs heavier (17 lb fluoro jig, 14 lb crank line) or gets wrapped up.
  if (LAKES[lakeId]?.cover.some((c) => c.type === 'standing'))
    return [
      { id: 'r1', rodId: STARTER_RODS[1], line: { type: 'fluoro', testLb: 12 }, lureId: 'ned', colorId: 'greenPumpkin' },
      { id: 'r2', rodId: STARTER_RODS[2], line: { type: 'fluoro', testLb: 17 }, lureId: 'tube', colorId: 'greenPumpkin' },
      { id: 'r3', rodId: STARTER_RODS[2], line: { type: 'fluoro', testLb: 14 }, lureId: 'squarebill', colorId: 'sexyShad' },
      { id: 'r4', rodId: STARTER_RODS[2], line: { type: 'mono', testLb: 17 }, lureId: 'walker', colorId: 'bone' },
    ];
  return [
    { id: 'r1', rodId: STARTER_RODS[0], line: { type: 'fluoro', testLb: 8 }, lureId: 'ned', colorId: 'greenPumpkin' },
    { id: 'r2', rodId: STARTER_RODS[0], line: { type: 'fluoro', testLb: 8 }, lureId: 'tube', colorId: 'greenPumpkin' },
    { id: 'r3', rodId: STARTER_RODS[1], line: { type: 'fluoro', testLb: 12 }, lureId: 'squarebill', colorId: 'sexyShad' },
    { id: 'r4', rodId: STARTER_RODS[1], line: { type: 'mono', testLb: 14 }, lureId: 'walker', colorId: 'bone' },
  ];
}

interface BotStats {
  bag: number;
  place: number;
  field: number;
  winner: number;
  median: number;
  bites: number;
  landed: number;
  lost: number;
  bycatch: number;
  shorts: number;
  casts: number;
  botBig: number;
  fieldBig: number;
  wraps: number;
  feed: number;
  leads: number;
  places: number;
  phaseTime: Record<string, number>;
}

export function runBotDay(seed: number, lakeId = 'champlain', tier: Tier = 'Amateur', skill = 1, deck?: RodSetup[]): BotStats {
  const s: TournamentState = createTournament({ lakeId, tier, seed, deck: deck ?? botDeck(lakeId) });
  const feedCount = { rivalCatch: 0, leaderChange: 0, playerPlace: 0, wraps: 0 };
  const rng = new Rng(seed ^ 0x9e3779b9);
  const lake = LAKES[lakeId];
  const grid = getLakeGrid(lake);
  // Players are shown GPS waypoints on the amateur lake; the bot mostly fishes those.
  const spots = [
    ...lake.waypoints.map((w) => ({ x: w.x, y: w.y })),
    ...lake.waypoints.map((w) => ({ x: w.x, y: w.y })),
    ...lake.cover.map((c) => ({ x: c.x, y: c.y })),
  ];
  let castsHere = 0;
  let t = 0;
  let phaseT = 0;
  let lastPhase = s.phase;
  let landed = 0;
  let shorts = 0;
  let nextAction = 0;
  let twitches = 0;
  const phaseTime: Record<string, number> = {};

  const chooseRod = () => {
    if (s.deck.length === 1) return 0;
    const light = lightLevel(s.clockMin, s.conditions.weather);
    const surfaceOk = s.conditions.waterTempF >= 60 && light < 0.55;
    if (surfaceOk) return 3;
    const r = rng.next();
    return r < 0.4 ? 1 : r < 0.75 ? 0 : 2;
  };

  const moveSpot = () => {
    const spot = rng.pick(spots);
    for (let k = 0; k < 40; k++) {
      const p = { x: spot.x + rng.range(-20, 20), y: spot.y + rng.range(-20, 20) };
      if (isWater(grid, p.x, p.y)) {
        const travel = Math.hypot(p.x - s.boat.pos.x, p.y - s.boat.pos.y) / TUNING.boat.outboardMaxSpeed;
        s.clockMin += travel * TUNING.clock.gameMinPerSec;
        s.boat.pos = p;
        s.boat.heading = rng.range(0, Math.PI * 2);
        break;
      }
    }
    castsHere = 0;
  };

  moveSpot();
  while (s.phase !== 'WeighIn' && t < 3600) {
    const input = emptyInput();
    if (s.phase !== lastPhase) {
      phaseT = 0;
      lastPhase = s.phase;
      nextAction = 0;
      twitches = 0;
    }
    phaseT += DT;
    switch (s.phase) {
      case 'Navigate':
        if (castsHere === 0) input.fishHere = true;
        else moveSpot();
        break;
      case 'Cast': {
        if (castsHere >= 10 && !s.cast?.flying) {
          input.moveOn = true;
          moveSpot();
          break;
        }
        const cs = s.cast;
        if (!cs) break;
        if (!cs.powerCharging && !cs.flying) {
          s.activeRod = chooseRod();
          cs.aimAngle = rng.range(-1, 1);
          input.castTap = true;
        } else if (cs.powerCharging && cs.power > 0.75 + rng.range(0, 0.2)) {
          input.castTap = true;
          castsHere++;
        }
        break;
      }
      case 'Present': {
        const lure = LURES[s.deck[s.activeRod].lureId];
        const p = s.present!;
        switch (lure.style) {
          case 'steady':
            input.reel = phaseT > 0.4;
            break;
          case 'bottom':
            if (p.onBottom || phaseT > 6) {
              input.reel = (phaseT * skill) % 4 < 3;
              if (phaseT >= nextAction) {
                input.twitch = true;
                nextAction = phaseT + rng.range(2.5, 4.5);
              }
            }
            break;
          case 'shake':
            if (p.onBottom && phaseT >= nextAction) {
              input.twitch = true;
              nextAction = phaseT + 0.9;
              twitches++;
              if (twitches % 6 === 0) nextAction += 0.6;
            }
            input.reel = p.onBottom && twitches % 8 === 7;
            break;
          case 'walk':
            if (phaseT >= nextAction) {
              input.twitch = true;
              twitches++;
              nextAction = phaseT + (twitches % 7 === 0 ? 1.6 : 0.5 + rng.normal(0, 0.03));
            }
            break;
          case 'twitchPause':
            if (phaseT >= nextAction) {
              input.twitch = true;
              twitches++;
              nextAction = phaseT + (twitches % 2 === 0 ? 2.5 : 0.35);
            }
            break;
        }
        break;
      }
      case 'Fight': {
        const f = s.fight!;
        if (f.jumpT > 0 && !f.jumpBowed && rng.chance(0.08 * skill)) input.bowFlick = true;
        if (f.tension < 0.7) input.reel = true;
        else if (f.tension < 0.85 && f.stamina > 0.4) input.brake = true;
        input.stick.x = -Math.sign(Math.sin(f.heading)) * 0.8;
        break;
      }
      case 'Landed':
        if (s.lastLanded) {
          if (s.lastLanded.weightLb > 0 && s.lastLanded.lengthIn < keeperMinIn(lake)) shorts++;
          landed++;
        }
        continueAfterLanded(s);
        break;
    }
    phaseTime[s.phase] = (phaseTime[s.phase] ?? 0) + DT;
    stepTournament(s, input, DT);
    for (const e of drainEvents(s)) {
      if (e.type === 'rivalCatch' || e.type === 'leaderChange' || e.type === 'playerPlace') feedCount[e.type]++;
      if (e.type === 'snap' && e.text?.startsWith('Wrapped')) feedCount.wraps++;
      if (process.env.BOT_TRACE && ['splash', 'edge', 'crash', 'retrieved', 'strike', 'shore'].includes(e.type))
        console.log(t.toFixed(1), e.type, s.deck[s.activeRod].lureId, s.present ? s.present.lureDepthFt.toFixed(1) : '', s.boat.pos.x.toFixed(0), s.boat.pos.y.toFixed(0));
    }
    t += DT;
  }
  const st = standings(s, true);
  const totals = st.map((x) => x.total).sort((a, b) => a - b);
  return {
    bag: bagWeight(s.livewell),
    place: st.findIndex((x) => x.isPlayer) + 1,
    field: st.length,
    winner: st[0].total,
    median: totals[Math.floor(totals.length / 2)],
    bites: s.stats.bites,
    landed,
    lost: s.stats.lost,
    bycatch: s.stats.bycatch,
    shorts,
    casts: s.stats.casts,
    botBig: s.stats.bigFishLb,
    fieldBig: Math.max(0, ...s.rivals.flatMap((r) => r.catches.map((c) => c.weightLb))),
    wraps: feedCount.wraps,
    feed: feedCount.rivalCatch,
    leads: feedCount.leaderChange,
    places: feedCount.playerPlace,
    phaseTime,
  };
}

const isMain = process.argv[1]?.endsWith('simulate.ts');
if (isMain) {
  const days = Number(process.argv[2] ?? 30);
  const lakeId = process.argv[3] ?? 'champlain';
  const tier = (process.argv[4] ?? 'Amateur') as Tier;
  const rows: BotStats[] = [];
  const t0 = Date.now();
  for (let i = 0; i < days; i++) rows.push(runBotDay(1000 + i * 7919, lakeId, tier));
  const pt: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.phaseTime)) pt[k] = (pt[k] ?? 0) + v / rows.length;
  console.log('real seconds per phase', Object.fromEntries(Object.entries(pt).map(([k, v]) => [k, Math.round(v)])));
  const avg = (k: Exclude<keyof BotStats, 'phaseTime'>) => (rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(2);
  const bags = rows.map((r) => r.bag).sort((a, b) => a - b);
  console.log(`${days} bot days on ${lakeId} (${tier}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`bot bag    median ${bags[Math.floor(bags.length / 2)].toFixed(2)}  p10 ${bags[Math.floor(bags.length * 0.1)].toFixed(2)}  p90 ${bags[Math.floor(bags.length * 0.9)].toFixed(2)}`);
  console.log(`field      median ${avg('median')}  winner ${avg('winner')}   bot avg place ${avg('place')} / ${rows[0].field}`);
  console.log(`per day    casts ${avg('casts')}  bites ${avg('bites')}  landed ${avg('landed')}  lost ${avg('lost')}  shorts ${avg('shorts')}  bycatch ${avg('bycatch')}  timber wraps ${avg('wraps')}`);
  const bigs = rows.map((r) => r.fieldBig).sort((a, b) => a - b);
  console.log(`big fish   bot best ${Math.max(...rows.map((r) => r.botBig)).toFixed(2)}  field big bass median ${bigs[Math.floor(bigs.length / 2)].toFixed(2)}  max ${bigs[bigs.length - 1].toFixed(2)}`);
  console.log(`feed/day   rival catches ${avg('feed')}  lead changes ${avg('leads')}  place calls ${avg('places')}`);
}
