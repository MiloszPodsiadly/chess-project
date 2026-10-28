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

  it('reconstructs move notation from server coordinates in the state owner', () => {
    const source = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) source.move(san);
    const externalMoves = source.history({ verbose: true }).map(move => ({
      from: move.from, to: move.to, promotion: move.promotion
    }));
    const state = new GameStateService();

    const history = state.loadExternalState(source.fen(), externalMoves, source.turn());

    expect(history.map(move => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(state.moves$.value).toEqual(history);
  });

  it('accepts the backend en-passant target for the latest double pawn push', () => {
    const chess = new Chess();
    chess.move('e4');
    const moves = chess.history({ verbose: true }).map(move => ({
      from: move.from, to: move.to, promotion: move.promotion
    }));
    const backendFen = chess.fen({ forceEnpassantSquare: true });
    const state = new GameStateService();

    expect(() => state.loadExternalState(backendFen, moves, chess.turn())).not.toThrow();
  });

  it('rejects an en-passant target left over from an earlier move', () => {
    const chess = new Chess();
    for (const san of ['e4', 'a6', 'e5', 'd5', 'exd6', 'a5']) chess.move(san);
    const moves = chess.history({ verbose: true }).map(move => ({
      from: move.from, to: move.to, promotion: move.promotion
    }));
    const corruptedFen = chess.fen().split(' ');
    corruptedFen[3] = 'd6';
    const state = new GameStateService();
    const initialFen = state.fen$.value;

    expect(() => state.loadExternalState(corruptedFen.join(' '), moves, chess.turn()))
      .toThrow('Game history does not match the server position');
    expect(state.fen$.value).toBe(initialFen);
  });
});
