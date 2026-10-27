import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { localOutcome, multiplayerOutcome, serverOutcome } from './game-outcome';
import { GameStateService } from './game-state.service';

describe('typed game outcome', () => {
  it('gets checkmate winner from the position for either player color', () => {
    const whiteWin = new Chess();
    ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'].forEach(move => whiteWin.move(move));
    expect(localOutcome(whiteWin, 'WHITE', 'one')?.perspective).toBe('WIN');
    expect(localOutcome(whiteWin, 'BLACK', 'one')?.perspective).toBe('LOSS');
    expect(localOutcome(whiteWin, 'WHITE', 'one')?.result).toBe('WHITE_WIN');

    const blackWin = new Chess();
    ['f3', 'e5', 'g4', 'Qh4#'].forEach(move => blackWin.move(move));
    expect(localOutcome(blackWin, 'BLACK', 'two')?.perspective).toBe('WIN');
    expect(localOutcome(blackWin, 'WHITE', 'two')?.perspective).toBe('LOSS');
  });

  it('distinguishes resignation, stalemate and fifty-move draw', () => {
    const start = new Chess();
    expect(localOutcome(start, 'WHITE', 'one', true)).toMatchObject({
      result: 'BLACK_WIN', endReason: 'RESIGNATION', perspective: 'LOSS'
    });
    expect(localOutcome(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'WHITE', 'two'))
      .toMatchObject({ result: 'DRAW', endReason: 'STALEMATE' });
    expect(localOutcome(new Chess('8/8/8/8/8/8/R7/K6k w - - 100 51'), 'WHITE', 'three'))
      .toMatchObject({ result: 'DRAW', endReason: 'FIFTY_MOVE_RULE' });
  });

  it('uses the server result for timeouts and excludes engine failures', () => {
    const base = { gameId: 'native', fen: new Chess().fen(), sideToMove: 'WHITE' as const,
      moves: [], version: 1, turnState: 'FINISHED' as const, playerColor: 'BLACK' as const,
      engineError: null, endReason: 'TIME_OUT' };
    expect(serverOutcome({ ...base, result: 'BLACK_WIN' })?.perspective).toBe('WIN');
    expect(serverOutcome({ ...base, result: 'ONGOING', turnState: 'ENGINE_FAILED' })).toBeNull();
  });

  it('preserves the multiplayer disconnect timeout reason and player perspective', () => {
    const game = {
      gameId: 'online', fen: new Chess().fen(), result: 'BLACK_WIN', endReason: 'DISCONNECT_TIMEOUT', moves: []
    } as any;
    expect(multiplayerOutcome(game, 'BLACK')).toMatchObject({
      perspective: 'WIN', endReason: 'DISCONNECT_TIMEOUT'
    });
    expect(multiplayerOutcome(game, 'WHITE')?.perspective).toBe('LOSS');
    expect(multiplayerOutcome(game, null)?.perspective).toBe('NEUTRAL');
  });
});

describe('restored chess history', () => {
  it('preserves threefold repetition and rejects inconsistent snapshots', () => {
    const original = new Chess();
    const moves = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']
      .map(san => original.move(san));
    const state = new GameStateService();
    state.loadExternalState(original.fen(), moves, original.turn());
    expect(state.outcome('WHITE')?.endReason).toBe('THREEFOLD_REPETITION');
    expect(state.moves$.value).toHaveLength(8);
    expect(() => state.loadExternalState(new Chess().fen(), moves, 'w')).toThrow(/history/);
    expect(state.moves$.value).toHaveLength(8);
  });
});
