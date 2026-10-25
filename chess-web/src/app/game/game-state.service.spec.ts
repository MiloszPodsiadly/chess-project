import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { GameStateService } from './game-state.service';

function play(state: GameStateService, from: string, to: string) {
  expect(state.attemptMove(from, to)).toBe(true);
}

describe('GameStateService check annotations', () => {
  it('marks a checkmated Black king and rejects further moves', () => {
    const state = new GameStateService();
    play(state, 'e2', 'e4'); play(state, 'f7', 'f6'); play(state, 'd2', 'd4'); play(state, 'g7', 'g5');
    play(state, 'd1', 'h5');
    expect(state.positionStatus$.value).toBe('CHECKMATE');
    expect(state.checkedKingSquare$.value).toBe('e8');
    expect(state.attemptMove('g5', 'g4')).toBe(false);
  });

  it('marks a checked White king and allows a legal reply', () => {
    const state = new GameStateService();
    play(state, 'e2', 'e4'); play(state, 'e7', 'e5'); play(state, 'f2', 'f4'); play(state, 'd8', 'h4');
    expect(state.positionStatus$.value).toBe('CHECK');
    expect(state.checkedKingSquare$.value).toBe('e1');
    play(state, 'g2', 'g3');
    expect(state.positionStatus$.value).toBe('NORMAL');
    expect(state.checkedKingSquare$.value).toBeNull();
  });

  it('restores the same check annotation from validated move history', () => {
    const chess = new Chess();
    for (const san of ['e4', 'e5', 'f4', 'Qh4+']) chess.move(san);
    const state = new GameStateService();
    state.loadExternalState(chess.fen(), chess.history({ verbose: true }).map(move => ({
      san: move.san, from: move.from, to: move.to, promotion: move.promotion
    })), chess.turn());
    expect(state.positionStatus$.value).toBe('CHECK');
    expect(state.checkedKingSquare$.value).toBe('e1');
  });
});
