// Game UI kit: every interactive piece answers a tap with motion + sound (+ haptic where it
// matters), in one "tournament broadcast" visual language. Screens should only compose these.
import { AnimatePresence, LazyMotion, m, MotionConfig, animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { playUi, type UiCue } from '../../audio/sound';
import { assetUrl } from '../../game/assets';
import { IOS, switchProps, vibrate } from './haptics';
import { Icon, type IconName } from './Icon';

export { Icon, type IconName };

const loadFeatures = () => import('./motionFeatures').then((r) => r.default);

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

export const spring = { type: 'spring', stiffness: 520, damping: 34 } as const;
/** Matches --skew in styles.css. */
export const SKEW = -10;
const press = { scale: 0.95 };

// ---------- Button ----------
type Variant = 'primary' | 'default' | 'danger' | 'plain';
export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: 'md' | 'lg' | 'xl';
  /** Sound on tap. Defaults to 'confirm' for primary, 'tap' otherwise; null for silence. */
  cue?: UiCue | null;
  /** Haptic tick on tap (iPhone via the switch technique, Android via vibrate). */
  haptic?: boolean;
  skew?: boolean;
  icon?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export function Button({ children, onClick, variant = 'default', size = 'md', cue, haptic, skew, icon, disabled, className, style, ariaLabel }: ButtonProps) {
  const cls = `btn ${variant} ${size === 'md' ? '' : size} ${skew ? 'skew' : ''} ${icon ? 'icon' : ''} ${className ?? ''}`;
  const fire = () => {
    if (disabled) return;
    const c = cue === undefined ? (variant === 'primary' ? 'confirm' : 'tap') : cue;
    if (c) playUi(c);
    if (haptic) vibrate();
    onClick?.();
  };
  const content = skew ? <span className="row" style={{ gap: 8 }}>{children}</span> : children;
  // Motion owns the transform (press scale), so the broadcast skew goes through it too.
  const mstyle = skew ? { ...style, skewX: SKEW } : style;
  if (haptic && IOS) {
    return (
      <m.label
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        className={cls}
        style={mstyle}
        whileTap={disabled ? undefined : press}
        transition={spring}
        // The label forwards a second click to its switch; only act on the user's own click.
        onClick={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && fire()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fire()}
      >
        <input {...switchProps} className="haptic-switch" tabIndex={-1} aria-hidden="true" disabled={disabled} />
        {content}
      </m.label>
    );
  }
  return (
    <m.button type="button" className={cls} style={mstyle} disabled={disabled} aria-label={ariaLabel} whileTap={disabled ? undefined : press} transition={spring} onClick={fire}>
      {content}
    </m.button>
  );
}

/** Square icon button (back, close, settings). */
export function IconButton({ name, onClick, label, cue = 'tap' }: { name: IconName; onClick: () => void; label: string; cue?: UiCue | null }) {
  return (
    <Button icon cue={cue} onClick={onClick} ariaLabel={label}>
      <Icon name={name} size={22} />
    </Button>
  );
}

// ---------- Broadcast pieces ----------
export function Slug({ children, tone = 'accent', size, className, style }: { children: ReactNode; tone?: 'accent' | 'dark' | 'gold' | 'red' | 'good'; size?: 'lg'; className?: string; style?: CSSProperties }) {
  return (
    <span className={`slug ${tone === 'accent' ? '' : tone} ${size ?? ''} ${className ?? ''}`} style={style}>
      <span>{children}</span>
    </span>
  );
}

/** TV lower-third: kicker slug over a big title bar that wipes in from the left. */
export function LowerThird({ kicker, title, sub, kickerTone, delay = 0 }: { kicker?: ReactNode; title: ReactNode; sub?: ReactNode; kickerTone?: 'accent' | 'dark' | 'gold' | 'red'; delay?: number }) {
  return (
    <div className="lower-third">
      {kicker && (
        <m.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay }}>
          <Slug tone={kickerTone}>{kicker}</Slug>
        </m.div>
      )}
      <m.div
        className="lt-main"
        initial={{ clipPath: 'inset(0 100% 0 0)' }}
        animate={{ clipPath: 'inset(0 0% 0 0)' }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: delay + 0.08 }}
      >
        <div className="lt-title">{title}</div>
        {sub && <div className="lt-sub">{sub}</div>}
      </m.div>
    </div>
  );
}

export interface ScoreItem {
  label: ReactNode;
  value: ReactNode;
  icon?: IconName;
  accent?: boolean;
}
export function Scorebug({ items, className, style }: { items: ScoreItem[]; className?: string; style?: CSSProperties }) {
  return (
    <div className={`scorebug ${className ?? ''}`} style={style}>
      {items.map((it, i) => (
        <div key={i} className={`sb-cell ${it.accent ? 'accent' : ''}`}>
          <span className="sb-label">
            {it.icon && <Icon name={it.icon} size={12} />}
            {it.label}
          </span>
          <span className="sb-value">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Numbers ----------
/**
 * Tabular number that tweens to its value. `settle` overshoots and wobbles like a digital scale
 * finding its reading. Re-renders animate from the previous value.
 */
export function CountUp({
  value,
  format,
  from,
  duration = 0.9,
  delay = 0,
  settle = false,
  className,
  onDone,
}: {
  value: number;
  format: (n: number) => ReactNode;
  from?: number;
  duration?: number;
  delay?: number;
  settle?: boolean;
  className?: string;
  onDone?: () => void;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(from ?? value);
  const [shown, setShown] = useState(from ?? value);
  useMotionValueEvent(mv, 'change', setShown);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      done.current?.();
      return;
    }
    const start = mv.get();
    const frames = settle && value > 0 ? [start, value * 1.035, value * 0.986, value * 1.005, value] : [start, value];
    const c = animate(mv, frames, {
      duration: settle ? duration + 0.6 : duration,
      delay,
      ease: settle ? ['easeOut', 'easeInOut', 'easeInOut', 'easeOut'] : [0.22, 1, 0.36, 1],
      times: settle ? [0, 0.62, 0.8, 0.92, 1] : undefined,
      onComplete: () => done.current?.(),
    });
    return () => c.stop();
  }, [value, settle, duration, delay, reduce, mv]);
  return <span className={`num ${className ?? ''}`}>{format(shown)}</span>;
}

// ---------- Inputs ----------
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <m.button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`seg ${o.value === value ? 'on' : ''}`}
          whileTap={press}
          onClick={() => {
            if (o.value === value) return;
            playUi('tap');
            onChange(o.value);
          }}
        >
          {o.value === value && <m.div layoutId={`seg-${id}`} className="seg-pill" transition={spring} />}
          <span>{o.label}</span>
        </m.button>
      ))}
    </div>
  );
}

export function Stepper<T extends number>({ values, value, onChange, format }: { values: T[]; value: T; onChange: (v: T) => void; format: (v: T) => ReactNode }) {
  const i = Math.max(0, values.indexOf(value));
  return (
    <div className="stepper">
      <Button icon cue="tick" disabled={i <= 0} onClick={() => onChange(values[i - 1])} ariaLabel="Less">
        <Icon name="minus" />
      </Button>
      <m.span key={value} className="num" initial={{ y: -6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} transition={spring}>
        {format(value)}
      </m.span>
      <Button icon cue="tick" disabled={i >= values.length - 1} onClick={() => onChange(values[i + 1])} ariaLabel="More">
        <Icon name="plus" />
      </Button>
    </div>
  );
}

/** Native switch: on iPhone the toggle itself plays the system haptic. */
export function Switch({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <input
        {...switchProps}
        checked={checked}
        onChange={(e) => {
          playUi('tick');
          vibrate();
          onChange(e.target.checked);
        }}
      />
    </label>
  );
}

export function Rail({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rail ${className ?? ''}`} style={style}>
      {children}
    </div>
  );
}

// ---------- Sheets ----------
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  center,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  center?: boolean;
}) {
  useEffect(() => {
    if (open) playUi('open');
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <m.div
          className={`sheet-back ${center ? 'center' : ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => {
            playUi('back');
            onClose();
          }}
        >
          <m.div
            className={`sheet ${center ? 'center' : ''}`}
            initial={center ? { scale: 0.92, opacity: 0 } : { x: '100%' }}
            animate={center ? { scale: 1, opacity: 1 } : { x: 0 }}
            exit={center ? { scale: 0.95, opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="sheet-head">
                <Slug size="lg">{title}</Slug>
                <IconButton name="close" label="Close" cue="back" onClick={onClose} />
              </div>
            )}
            <div className="sheet-body">{children}</div>
            {footer && <div className="sheet-foot">{footer}</div>}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** Replaces window.confirm(): a centred card with a clear destructive/confirm choice. */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      center
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button cue="back" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} haptic onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 16 }}>{body}</p>
    </Sheet>
  );
}

// ---------- Scenes ----------
/**
 * Painted backdrop, cover-fitted and slowly drifting. Children are positioned in the art's own
 * coordinates (percent of the 16:9 image), so hotspots stay glued to what they point at.
 */
export function Scene({ id, dim, drift = true, children }: { id?: string | null; dim?: 'left' | 'right' | 'bottom' | 'full' | 'heavy' | 'soft'; drift?: boolean; children?: ReactNode }) {
  const url = id ? assetUrl(id) : null;
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="scene">
      <div className={`scene-art ${drift ? 'drift' : ''}`}>
        <div className="scene-frame">
          {url && (
            <m.img
              src={url}
              alt=""
              initial={{ opacity: 0 }}
              animate={{ opacity: loaded ? 1 : 0 }}
              transition={{ duration: 0.5 }}
              onLoad={() => setLoaded(true)}
              draggable={false}
            />
          )}
          {children}
        </div>
      </div>
      {dim && <div className={`scene-dim ${dim}`} />}
    </div>
  );
}

/** Staggered entrance for a group of children (lists, stacks, stat strips). */
export const stagger = (delayChildren = 0.05, each = 0.05) => ({
  initial: 'hidden',
  animate: 'show',
  variants: { hidden: {}, show: { transition: { delayChildren, staggerChildren: each } } },
});
export const rise = {
  variants: {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: spring },
  },
};
export const slideIn = {
  variants: {
    hidden: { opacity: 0, x: -24 },
    show: { opacity: 1, x: 0, transition: spring },
  },
};
