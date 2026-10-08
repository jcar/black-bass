// Help sheets shared by the morning briefing and the in-game pause menu.
import type { ReactNode } from 'react';
import { LAKES } from '../data/lakes';
import { KEY_HINTS } from '../game/input';
import { isCwir, keeperMinIn } from '../sim/livewell';
import { formatClock } from '../sim/conditions';
import { TUNING } from '../data/tuning';
import type { TournamentState } from '../sim/types';
import { adviceFor } from '../sim/tierAdvice';
import { useStore } from '../state/store';
import { DayPlan, RigCheck, ScoutingReport } from './ProAdvice';
import { Sheet } from './kit';

/** Today's plan: which of your rigs to throw in each part of the day, and where (as much as the tier shows). */
export function ProPlanSheet({ t, open, onClose, footer }: { t: TournamentState; open: boolean; onClose: () => void; footer?: ReactNode }) {
  const c = t.conditions;
  const access = adviceFor(t.tier);
  if (access.plan === 'scouting')
    return (
      <Sheet open={open} onClose={onClose} title="Scouting report" footer={footer}>
        <p className="small" style={{ color: 'var(--accent)' }}>
          {access.label}
        </p>
        {open && <ScoutingReport lakeId={t.lakeId} spots={false} />}
        <RigCheck lakeId={t.lakeId} deck={t.deck} />
      </Sheet>
    );
  return (
    <Sheet open={open} onClose={onClose} title="Today's pro plan" footer={footer}>
      <p className="small muted">
        Which of your rigs pulls the most bites in each part of the day, from today's water ({Math.round(c.waterTempF)}°F, {c.season.toLowerCase()}), light, wind and where the fish are holding.
      </p>
      <DayPlan lakeId={t.lakeId} conditions={c} deck={t.deck} tier={t.tier} />
      <RigCheck lakeId={t.lakeId} deck={t.deck} />
    </Sheet>
  );
}

/** Controls and the rules of the bag. */
export function HowToFishSheet({ lakeId, open, onClose }: { lakeId: string; open: boolean; onClose: () => void }) {
  const lake = LAKES[lakeId];
  const autoHookset = useStore((s) => s.save.settings.autoHookset);
  const minIn = keeperMinIn(lake);
  const slot = lake?.regs?.slot;
  const cwir = isCwir(lake);
  return (
    <Sheet open={open} onClose={onClose} title="How to fish">
      <div className="col small" style={{ gap: 10, fontSize: 15 }}>
        <p>
          <strong>Left thumb</strong> steers the boat, aims the cast and works the rod: tap to twitch, flick down to bow when a fish jumps.
        </p>
        <p>
          <strong>Right thumb</strong> fishes and casts, reels, and thumbs the spool as a brake.
        </p>
        <p>
          <strong>Work the bait the way it's built:</strong> hold REEL steady for crankbaits and bladed jigs; let bottom baits sink, then drag
          with short pulls and hops; twitch then pause a jerkbait; walk a topwater with an even rhythm. The on-screen hint follows the lure on your rod.
        </p>
        <p>
          <strong>Set the hook:</strong> when a fish has the bait you feel the thump and HOOK (H on a keyboard) glows where REEL was. Set then:
          too soon and you pull it away (on topwater, wait to feel the weight after the blow-up); too late and it spits it. Stretchy line on a long
          cast, trebles on braid and a rod too light for the bait cost a few hook-ups. {autoHookset ? 'Auto hookset is on (Settings): it sets for you.' : 'Prefer it done for you? Turn on Auto hookset in Settings.'}
        </p>
        <p>
          <strong>Cover and grass:</strong> weedless baits (Texas rig, flipping jig, frog; a spinnerbait mostly) go right into docks and wood
          without spooking the fish. Treble baits that tick into grass come back fouled: twitch to rip them free, which is a strike trigger too.
        </p>
        <p>
          <strong>Drop shot:</strong> cast to fish you saw on the sonar. THUMB (B) on the fall stops it at a suspended fish's depth; then shake it in
          place. The longer it sits on a fish, the closer the fish comes.
        </p>
        <p>
          <strong>The fight:</strong> hold REEL and let the drag do the work. Past the drag the line warns you; thumbing the spool or a jump on a
          tight line can still break it, so bow when a fish jumps.
        </p>
        <p className="muted">
          <strong>Keyboard:</strong> {KEY_HINTS}.
        </p>
        <p>
          Your <strong>five heaviest bass</strong> count. Shorts under {minIn}" and other species don't count.
          {cwir
            ? ` ${lake.name} runs catch-weigh-immediate-release (Texas Parks & Wildlife): a judge in your boat weighs and records every legal bass and it goes straight back, so there's no culling: your best five are kept on the card for you.${slot ? ` Slot fish (${slot.minIn}-${slot.maxIn}") can't be kept, but they're weighed and count.` : ''}${lake.regs?.bigFish ? ` One ${lake.regs.bigFish.minIn}"+ bass a day rides in the livewell to the weigh-in stage.` : ''}`
            : ` A sixth keeper means culling your smallest.${slot ? ` Slot fish (${slot.minIn}-${slot.maxIn}") are protected: they go straight back and don't count.` : ''}${lake?.regs?.bigFish ? ` Only ${lake.regs.bigFish.perDay} bass ${lake.regs.bigFish.minIn}" or longer may be kept a day.` : ''}`}
        </p>
        <p>
          <strong>Keep them alive:</strong> fish in the livewell go from lively to sluggish to dead, faster in warm water (80°F and up), after a long
          fight, and the bigger they are. Cull a sluggish fish first. A dead fish can't be culled and costs {TUNING.livewell.deadPenaltyLb * 16} oz at
          the scales.{cwir ? ' Under catch-weigh-release only your stage fish is in the livewell; the rest are already swimming.' : ''}
        </p>
        <p>
          <strong>Check in</strong> at the launch by {formatClock(TUNING.clock.dayEndMin)}: CHECK IN (K) there ends your day early. Late costs{' '}
          {TUNING.checkIn.latePenaltyLbPerMin} lb a minute, and more than {TUNING.checkIn.lateMaxMin} minutes late the day counts zero. "Head in" warns
          you in time for the run back, and the chip points home.
        </p>
      </div>
    </Sheet>
  );
}
