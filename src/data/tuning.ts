// Every gameplay constant lives here so balancing never means hunting through sim code.
// Sources for the real-world anchors are noted inline; anything marked (game) is a tuning knob.

export const TUNING = {
  clock: {
    dayStartMin: 6 * 60,
    dayEndMin: 15 * 60,
    /** 540 game minutes in ~15 real minutes = 0.6 game-min per real second (36x). */
    gameMinPerSec: 0.6,
    warnAtMin: 14 * 60 + 30,
    unhookBassMin: 1.5,
    unhookBycatchMin: 6,
    shoreSnagMin: 3,
    /** Stump strike: check the lower unit, trim up, idle back to a lane. */
    stumpMin: 8,
    popAttemptMin: 0.5,
  },

  boat: {
    /** (game) World speeds are compressed so a lake crossing takes ~40 real seconds. */
    outboardMaxSpeed: 75,
    /** On plane above this speed a stump field outside the lanes is dangerous. */
    stumpSpeed: 28,
    /** Per-second chance of hitting a stump while running a stump field off-lane on plane. */
    stumpChancePerSec: 0.35,
    trollingMaxSpeed: 4,
    /** Stick magnitude below this uses the quiet trolling motor. */
    trollingStickMax: 0.4,
    accel: 40,
    decel: 55,
    turnRate: 2.4,
    /** TPWD telemetry: boats within ~30 ft displaced 40% of fish. Scaled up for the compressed world. */
    outboardSpookRadius: 28,
    /** Per-second chance a fish within the radius spooks as the outboard passes (was 0.5 x 1.5). */
    outboardSpookPerSec: 0.75,
    trollingSpookPerSec: 0.3,
    /** Game minutes a trolling-motor bump spooks a fish for. */
    trollingSpookMin: 5,
    trollingSpookRadius: 5,
    spookMinMin: 15,
    spookMaxMin: 40,
    /** Must be nearly stopped to start fishing. */
    fishHereMaxSpeed: 6,
  },

  cast: {
    aimRate: 1.3,
    aimLimit: (70 * Math.PI) / 180,
    powerCyclesPerSec: 0.9,
    /** Distance (m) ~ base + k*sqrt(oz). Real casts are 30-40 yd; (game) shortened to ~22-27 m for pacing. */
    baseDistM: 11,
    distPerSqrtOz: 22,
    rodMismatchPenalty: 0.82,
    braidBonus: 1.05,
    monoPenalty: 0.97,
    lightLineBonus: 1.05,
    heavyLinePenalty: 0.94,
    windEffectPer15Mph: 0.12,
    flightBaseSec: 0.55,
    flightSecPerM: 0.022,
    crashSpookRadius: 12,
    crashSpookMin: 20,
  },

  lure: {
    /**
     * (game) Lure motion plays faster than life so a retrieve takes ~15-30 s, not minutes.
     * Cadence is still judged in real-world units (speed / this scale).
     */
    gameSpeedScale: 3,
    reelDiveRateFtPerSec: 1.6,
    floatUpFtPerSec: 0.8,
    twitchDistM: 0.45,
    twitchSec: 0.22,
    hopHeightFt: 1.6,
    retrieveDoneM: 2.5,
    /** Steady baits: a stop shorter than this (a slipped thumb) doesn't restart the retrieve. */
    steadyGraceSec: 0.3,
    /** Swimming baits plane up this fast on a steady retrieve (ft/s, 12 lb line). */
    swimRiseFtPerSec: 0.25,
  },

  attraction: {
    /** 0..10 meter after the NES lure-action number (shown by the "MIRUN" name cheat): "6.0 or higher" is our strike line. */
    max: 10,
    strikeAt: 6,
    /**
     * Leaky interest (fish time): dI/dt = gainPerSec * fit - leakPerSec * I, so interest settles at
     * gain * fit / leak. A good fit crosses the strike line, a middling fit follows without
     * committing, a poor fit is ignored. (The old constant decay saturated: nearly any fish in
     * range eventually struck, so lure choice barely mattered. See docs/fish-model.md.)
     */
    gainPerSec: 11,
    leakPerSec: 1.2,
    followAt: 3,
    followSpeed: 1.1,
    strikeChargeSec: 0.55,
    /** Reaction strikes: deflection / pause-after-burst adds a spike to nearby fish. */
    reactionSpike: 2.6,
    depthSigmaBaseFt: 3,
    depthSigmaActiveFt: 8,
    /** Visual detection range (m) per metre of Secchi depth, clamped. */
    visualRangePerSecchiM: 1.7,
    visualRangeMin: 1.5,
    visualRangeMax: 9,
    vibrationRangeM: 4.5,
    muddyVibrationBonusM: 3,
    muddySecchiFt: 3.5,
    clearSecchiFt: 8,
    /** Research: colour changes catch rate little at constant clarity; keep effects within ~10%. */
    colorEffect: 0.1,
    hookShyPenalty: 0.7,
    coverBonus: 1.3,
  },

  activity: {
    tempSigmaBelowF: 14,
    tempSigmaAboveF: 7,
    tempFloor: 0.12,
    pressure: { falling: 1.3, steady: 1.0, rising: 0.75 },
    postFront: 0.55,
    trendPerF: 0.08,
    trendCap: 0.15,
    weather: { Bluebird: 0.9, Overcast: 1.1, Windy: 1.1, Rain: 1.15 },
    season: { Prespawn: 1.2, Spawn: 0.95, Postspawn: 0.8, Summer: 1.0, Fall: 1.15, Turnover: 0.6, Winter: 0.5 },
  },

  fight: {
    knotStrength: 0.9,
    /**
     * Reel drag, as a fraction of the line's knot-adjusted breaking strength (anglers set it near
     * 25-35% of line test). Above it the spool slips and the fish takes line instead of the tension
     * climbing, so light line lands ordinary fish. Thumbing the spool while reeling locks it.
     */
    dragSetting: 0.35,
    /** Share of a surge above the drag that still reaches the line: washers stick on a hard run. (game) */
    dragOverrun: 0.4,
    /** HUD line warnings (fraction of breaking strength): warn as soon as you're past the drag. */
    tensionWarn: 0.5,
    tensionDanger: 0.75,
    /** At or below this stamina a fish is beaten ("Beat" in the HUD): no more runs, it skates in. */
    beatStamina: 0.25,
    /** A beaten fish: reel gains this much faster, it pulls and swims this much weaker. (game) */
    beatReelMult: 2.5,
    beatPullMult: 0.4,
    beatSwimMult: 0.3,
    /** Standing timber: above this tension a running fish can wrap the line around a trunk. */
    wrapTension: 0.62,
    /** Per-second wrap chance at full tension on 12 lb line; scales down with heavier line. */
    wrapChancePerSec: 0.55,
    /** Braid saws through wood instead of fraying on it. */
    wrapBraidFactor: 0.35,
    /** Pull vs body weight: sustained ~0.3-0.5x, bursts ~1-2x (estimates; no hard data exists). */
    sustainedPullMult: 0.38,
    burstPullMult: 1.2,
    burstSpeed: 3.4,
    cruiseSpeed: 1.0,
    reelSpeed: 1.5,
    freeSpoolLb: 0.6,
    dragThroughWaterMult: 0.15,
    brakeTensionMult: 1.15,
    rodLoadLb: { ML: 1.0, M: 1.5, MH: 2.2, H: 3.0, XH: 3.8 },
    /** Line stretch (fraction at break): braid 1-3%, fluoro 10-15%, mono 20-30%. */
    stretch: { braid: 0.02, fluoro: 0.12, mono: 0.25 },
    staminaBaseDrain: 0.018,
    staminaTensionDrain: 0.055,
    staminaBrakeDrain: 0.06,
    staminaRodTurnDrain: 0.045,
    staminaBurstDrain: 0.035,
    staminaRecover: 0.01,
    landDistM: 2.5,
    landStaminaMax: 0.35,
    maxLineOutM: 90,
    revealDistM: 12,
    jumpWindowSec: 0.9,
    jumpSpikeMult: 2.2,
    thrownChanceUnbowed: 0.22,
    thrownChanceTreble: 0.28,
    thrownChanceBowed: 0.04,
    popChance: 0.35,
    turnRate: 1.4,
  },

  population: {
    /** Fraction of fish placed away from obvious cover (TPWD: ~40% of time on featureless flats). */
    offStructureFrac: 0.3,
    /** Default minimum length; lakes can override with `regs.minIn`. */
    keeperMinIn: 12,
    trophyStructureBias: 0.12,
  },

  multiDay: {
    pressurePerDay: 0.15,
    hookShyPerCatch: 0.5,
  },
} as const;

export type Tuning = typeof TUNING;
