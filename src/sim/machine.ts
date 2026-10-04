import type { GamePhase, TournamentState } from './types';

/** Strict phase graph, mirroring the NES flow: map -> cast -> work the lure -> fight -> landed. */
export const TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  Navigate: ['Cast', 'WeighIn'],
  Cast: ['Navigate', 'Present', 'WeighIn'],
  Present: ['Cast', 'Fight', 'WeighIn'],
  Fight: ['Landed', 'Cast', 'WeighIn'],
  Landed: ['Cast', 'WeighIn'],
  WeighIn: ['Navigate'],
};

export class IllegalTransitionError extends Error {
  constructor(from: GamePhase, to: GamePhase) {
    super(`Illegal phase transition ${from} -> ${to}`);
  }
}

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(s: TournamentState, to: GamePhase): void {
  if (s.phase === to) return;
  if (!canTransition(s.phase, to)) throw new IllegalTransitionError(s.phase, to);
  s.phase = to;
}
