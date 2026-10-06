import { AnimatePresence, m } from 'motion/react';
import { useEffect } from 'react';
import { useStore, type Notice } from '../../state/store';
import { Slug, spring } from '../kit';

const TICKER_MS = 4200;

/** Centre-screen banner for the rare big moments (line break, stump, time). */
export function Banner() {
  const banner = useStore((s) => s.notices.find((n) => n.kind === 'banner'));
  return (
    <AnimatePresence>
      {banner && (
        <m.div
          key={banner.id}
          className={`banner ${banner.tone}`}
          initial={{ opacity: 0, scale: 1.25 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        >
          <div className="banner-title">
            <span>{banner.title}</span>
          </div>
          {banner.sub && <div className="banner-sub">{banner.sub}</div>}
        </m.div>
      )}
    </AnimatePresence>
  );
}

/**
 * One strip under the scorebug. A bug (urgent: time warning, place change) takes it; otherwise the
 * live ticker plays its queue one item at a time. The ticker holds during fights and the catch card
 * so nothing pulls your eye off the fish.
 */
export function NoticeStrip({ hold }: { hold: boolean }) {
  const bug = useStore((s) => s.notices.find((n) => n.kind === 'bug'));
  const ticker = useStore((s) => s.notices.find((n) => n.kind === 'ticker'));
  const dismiss = useStore((s) => s.dismissNotice);
  const showTicker = !bug && !hold && ticker;

  useEffect(() => {
    if (!showTicker) return;
    const id = setTimeout(() => dismiss(showTicker.id), TICKER_MS);
    return () => clearTimeout(id);
  }, [showTicker, dismiss]);

  const item: Notice | undefined = bug ?? (showTicker || undefined);
  return (
    <div className="notice-strip">
      <AnimatePresence mode="wait">
        {item && (
          <m.div
            key={item.id}
            className={`strip ${item.kind} ${item.tone}`}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18, transition: { duration: 0.15 } }}
            transition={spring}
          >
            {item.kind === 'ticker' && <Slug tone={item.tone === 'gold' ? 'gold' : 'dark'}>Live</Slug>}
            <span className="strip-title">{item.title}</span>
            {item.sub && <span className="strip-sub">{item.sub}</span>}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Coach tips: a wrapping card on the left, under the sonar inset, held during fights. */
export function CoachCard({ hold }: { hold: boolean }) {
  const coach = useStore((s) => s.notices.find((n) => n.kind === 'coach'));
  const dismiss = useStore((s) => s.dismissNotice);
  const show = hold ? undefined : coach;
  return (
    <div className="coach-card-wrap">
      <AnimatePresence>
        {show && (
          <m.div key={show.id} className="coach-card hud-box" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12, transition: { duration: 0.15 } }} transition={spring} onClick={() => dismiss(show.id)}>
            <span className="row" style={{ gap: 8, alignItems: 'center' }}>
              <Slug tone="dark">Coach</Slug>
              <span className="strip-title">{show.title}</span>
            </span>
            {show.sub && <span className="coach-text">{show.sub}</span>}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Mirrors the newest notice for screen readers. */
export function NoticeLive() {
  const last = useStore((s) => s.notices[s.notices.length - 1]);
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {last ? `${last.title}${last.sub ? `. ${last.sub}` : ''}` : ''}
    </div>
  );
}
