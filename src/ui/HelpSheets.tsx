// Help sheets shared by the morning briefing and the in-game pause menu.
import type { ReactNode } from 'react';
import { LAKES } from '../data/lakes';
import { KEY_HINTS } from '../game/input';
import { keeperMinIn } from '../sim/livewell';
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
          Your <strong>five heaviest bass</strong> count. A sixth keeper means culling your smallest. Shorts under {minIn}" and other species don't count.
          {slot ? ` Slot fish (${slot.minIn}-${slot.maxIn}") are weighed in the boat by a marshal, released, and still count.` : ''}
        </p>
      </div>
    </Sheet>
  );
}
