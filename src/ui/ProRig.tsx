// "Rig me up like the pro": one button that buys and rigs what the pro advice suggests, previewed
// first. The plan comes from src/state/proRig.ts; the rod locker can change any of it afterwards.
import { useEffect, useMemo, useRef } from 'react';
import { LAKES } from '../data/lakes';
import { COLORS, LURES } from '../data/lures';
import { lineLabel, RODS } from '../data/rods';
import { rankLures, WINDOWS, type WindowId } from '../sim/advisor';
import type { Conditions } from '../sim/types';
import { applyProRig, planProRig, type ProPick } from '../state/proRig';
import { useStore } from '../state/store';
import { scoutReport } from './advice';
import { LureIcon, money } from './components';
import { Button, Sheet } from './kit';

const WINDOW_LABEL = Object.fromEntries(WINDOWS.map((w) => [w.id, w.label])) as Record<WindowId, string>;
const listOf = (ws: WindowId[]) => ws.map((w) => WINDOW_LABEL[w]).join(', ');

export function ProRigButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" haptic cue="open" onClick={onClick}>
      Rig me up like the pro
    </Button>
  );
}

/**
 * Preview of the pro's deck: the rigs, what has to be bought, cash before and after, and the picks
 * the budget couldn't cover. `conditions` plans for that day (rankLures); null plans from the
 * season's scouting report. `reserve` is cash kept back (the entry fee before entering).
 */
export function ProRigSheet({
  lakeId,
  open,
  onClose,
  onApplied,
  conditions,
  reserve,
  reserveLabel,
}: {
  lakeId: string;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  conditions: Conditions | null;
  reserve: number;
  reserveLabel?: string;
}) {
  const save = useStore((s) => s.save);
  const mutateSave = useStore((s) => s.mutateSave);
  const lake = LAKES[lakeId];
  const picks = useMemo<ProPick[] | null>(() => (!open || !lake ? null : conditions ? rankLures(lake, conditions) : scoutReport(lake).picks), [open, lake, conditions]);
  const plan = useMemo(() => (picks && lake ? planProRig({ save, lake, picks, reserveCash: reserve }) : null), [picks, lake, save, reserve]);

  const confirm = () => {
    if (!plan || !lake || !picks) return;
    if (plan.unchanged) return onApplied();
    // Re-plan on the save being changed so the purchases and the deck can't drift apart.
    mutateSave((s) => void applyProRig(s, planProRig({ save: s, lake, picks, reserveCash: reserve })));
    onApplied();
  };
  const confirmRef = useRef(confirm);
  useEffect(() => {
    confirmRef.current = confirm;
  });
  // Enter confirms (Escape is the sheet's). A focused button in this sheet keeps its own Enter; one
  // underneath it (the button that opened the preview) doesn't get it.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || body.current?.closest('.sheet')?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) confirmRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!lake) return null;
  const empty = !!plan && plan.rigs.length === 0;
  const label = !plan || plan.unchanged || empty ? 'Done' : plan.cost > 0 ? 'Buy & rig up' : 'Rig up';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Rig like the pro"
      footer={
        <>
          <Button cue="back" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" haptic onClick={empty ? onClose : confirm}>
            {label}
          </Button>
        </>
      }
    >
      <div ref={body} hidden />
      {plan && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {conditions ? "From today's pro plan" : `From the ${lake.name} scouting report`}: the best bait for each part of the day, then the next best, on the rod and line a pro would use.
          </p>
          {plan.unchanged && !empty && <p className="small" style={{ color: 'var(--good)', margin: 0 }}>You're already rigged like the pro: nothing to buy or change.</p>}
          {empty && <p className="small" style={{ color: 'var(--accent)', margin: 0 }}>None of the pro's rigs fit your cash right now. Your rods stay as they are.</p>}

          {plan.rigs.length > 0 && (
            <section className="col" style={{ gap: 6 }}>
              <span className="kicker">The pro's deck</span>
              {plan.rigs.map((r, i) => (
                <div key={r.setup.id} className="advice-row pro-rig">
                  <LureIcon lureId={r.setup.lureId} colorId={r.setup.colorId} size={46} />
                  <div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                    <span className="display" style={{ fontSize: 17 }}>
                      Rod {i + 1}: {LURES[r.setup.lureId].name}
                    </span>
                    <span className="small">
                      {COLORS[r.setup.colorId].name} · {lineLabel(r.setup.line)} · {RODS[r.setup.rodId].name}
                    </span>
                    <span className="small" style={{ color: 'var(--accent)' }}>
                      {r.bestFor.length ? `Best bait for ${listOf(r.bestFor)}` : `#${r.rank} overall`}
                      {r.windows.length > r.bestFor.length && <span className="muted"> · strong at {listOf(r.windows)}</span>}
                    </span>
                    <span className="small muted">{r.reasons.join(' · ')}</span>
                    {(r.buysLure || r.buysRod) && (
                      <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {r.buysLure && <span className="badge warn">Buy bait</span>}
                        {r.buysRod && <span className="badge warn">Buy rod</span>}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          {plan.buys.length > 0 && (
            <section className="col pro-buys" style={{ gap: 4 }}>
              <span className="kicker">To buy</span>
              {plan.buys.map((b) => (
                <div key={b.kind === 'rod' ? b.rodId : `${b.lureId}:${b.colorId}`} className="row small pro-buy">
                  {b.kind === 'lure' ? <LureIcon lureId={b.lureId!} colorId={b.colorId!} size={26} /> : <span className="badge">Rod</span>}
                  <span style={{ flex: 1, minWidth: 0 }}>{b.kind === 'lure' ? `${LURES[b.lureId!].name} · ${COLORS[b.colorId!].name}` : RODS[b.rodId!].name}</span>
                  <span className="num">{money(b.price)}</span>
                </div>
              ))}
              <div className="row small pro-buy total">
                <span style={{ flex: 1 }}>Total</span>
                <span className="num">{money(plan.cost)}</span>
              </div>
            </section>
          )}

          <div className="col small" style={{ gap: 2 }}>
            <span>
              Cash: <span className="num">{money(save.player.cash)}</span>
              {plan.cost > 0 && (
                <>
                  {' '}
                  → <span className="num">{money(plan.cashAfter)}</span> after buying
                </>
              )}
            </span>
            {reserve > 0 && (
              <span className="muted">
                Keeps {money(reserve)} back for {reserveLabel ?? 'the entry fee'}.
              </span>
            )}
          </div>

          {plan.skipped.length > 0 && (
            <section className="col small" style={{ gap: 4 }}>
              <span className="kicker">Left out: not enough cash</span>
              {plan.skipped.map((x) => (
                <div key={x.lureId} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <LureIcon lureId={x.lureId} colorId={picks?.find((p) => p.lureId === x.lureId)?.colorId ?? LURES[x.lureId].colors[0]} size={26} />
                  <span style={{ minWidth: 0 }}>{x.reason}</span>
                </div>
              ))}
            </section>
          )}

          {!plan.unchanged && (
            <p className="small" style={{ margin: 0 }}>
              {plan.cost > 0 ? 'Purchases are final. ' : ''}This replaces the rigs on your deck; change any rod, bait or line afterwards in the rod locker.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}
