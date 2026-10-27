import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { MultiplayerService } from './multiplayer.service';

describe('multiplayer event reconciliation', () => {
  it('ignores stale moves and requests a snapshot when an event version is skipped', () => {
    const service = new MultiplayerService();
    const initial = {
      gameId: 'game-1', fen: 'fen-v4', sideToMove: 'WHITE', result: 'ONGOING', endReason: 'NONE',
      moves: [], whiteTimeLeftMs: 1000, blackTimeLeftMs: 1000, version: 4
    } as any;
    service.gameState$.next(initial);
    const requestSync = vi.spyOn(service, 'requestSync');

    (service as any).handleMoveAccepted({
      gameId: 'game-1', fen: 'stale-fen', sideToMove: 'BLACK', move: { from: 'e2', to: 'e4' }, version: 3
    });
    expect(service.gameState$.value).toBe(initial);

    (service as any).handleMoveAccepted({
      gameId: 'game-1', fen: 'later-fen', sideToMove: 'BLACK', move: { from: 'e2', to: 'e4' }, version: 6
    });
    expect(service.gameState$.value).toBe(initial);
    expect(requestSync).toHaveBeenCalledWith('game-1');
  });

  it('replaces move history from a terminal snapshot so FEN and history stay aligned', () => {
    const service = new MultiplayerService();
    const prior = replayMoves(['f3', 'e5', 'g4']);
    service.gameState$.next({
      gameId: 'game-1', fen: prior.fen, sideToMove: 'BLACK', result: 'ONGOING', endReason: 'NONE',
      moves: prior.moves, whiteTimeLeftMs: 1000, blackTimeLeftMs: 1000, version: 3
    } as any);
    const final = replayMoves(['f3', 'e5', 'g4', 'Qh4#']);

    (service as any).handleGameEnded({
      gameId: 'game-1', fen: final.fen, sideToMove: 'WHITE', result: 'BLACK_WIN',
      endReason: 'CHECKMATE', whiteTimeLeftMs: 950, blackTimeLeftMs: 0, version: 4, moves: final.moves
    });

    expect(service.gameState$.value?.fen).toBe(final.fen);
    expect(service.gameState$.value?.moves).toEqual(final.moves);
    expect(service.gameState$.value?.version).toBe(4);
  });

  it('restores only a valid authoritative snapshot after reconnect', () => {
    const service = new MultiplayerService();
    const recovered = replayMoves(['e4', 'e5']);
    (service as any).awaitingRecoverySnapshot = true;
    service.connectionState$.next('RECOVERING_GAME');
    (service as any).handleGameStateSync({ state: {
      gameId: 'game-recovered', fen: recovered.fen, sideToMove: 'WHITE', result: 'ONGOING', endReason: 'NONE',
      moves: recovered.moves, whiteTimeLeftMs: 9000, blackTimeLeftMs: 9000, version: 2
    } });

    expect(service.gameState$.value?.gameId).toBe('game-recovered');
    expect(service.connectionState$.value).toBe('READY');
    expect(service.ready$.value).toBe(true);

    const accepted = service.gameState$.value;
    (service as any).handleGameStateSync({ state: { ...accepted, fen: 'not-a-fen' } });
    expect(service.gameState$.value).toBe(accepted);
    expect(service.lastError$.value).toBe('invalid_game_snapshot');
  });

  it('unsubscribes the previous game topic and avoids duplicate subscriptions', () => {
    const service = new MultiplayerService();
    const first = { unsubscribe: vi.fn() };
    const second = { unsubscribe: vi.fn() };
    const subscribe = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    (service as any).client = { subscribe };

    (service as any).subscribeGameTopic('game-1');
    (service as any).subscribeGameTopic('game-1');
    expect(subscribe).toHaveBeenCalledTimes(1);
    (service as any).subscribeGameTopic('game-2');
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it('ignores duplicate gameStarted events without resetting the board history', () => {
    const service = new MultiplayerService();
    const current = replayMoves(['e4']);
    service.gameState$.next({
      gameId: 'game-1', fen: current.fen, sideToMove: 'BLACK', result: 'ONGOING', endReason: 'NONE',
      moves: current.moves, whiteTimeLeftMs: 9000, blackTimeLeftMs: 9000, version: 1
    } as any);
    (service as any).currentGameId = 'game-1';
    const subscribe = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });
    (service as any).client = { subscribe };

    (service as any).handleGameStarted({
      gameId: 'game-1', fen: new Chess().fen(), sideToMove: 'WHITE', timeControlType: 'RAPID',
      whiteTimeLeftMs: 10000, blackTimeLeftMs: 10000, yourColor: 'WHITE', reconnectToken: 'rotated'
    });

    expect(service.gameState$.value?.moves).toEqual(current.moves);
    expect(service.gameState$.value?.fen).toBe(current.fen);
    expect(service.reconnectToken$.value).toBe('rotated');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('shows the match-found transition only after a real gameStarted event', () => {
    vi.useFakeTimers();
    const service = new MultiplayerService();
    expect(service.matchFound$.value).toBe(false);
    (service as any).handleGameStarted({
      gameId: 'game-match', fen: new Chess().fen(), sideToMove: 'WHITE', timeControlType: 'RAPID',
      whiteTimeLeftMs: 60000, blackTimeLeftMs: 60000, yourColor: 'WHITE', reconnectToken: 'token'
    });
    expect(service.matchFound$.value).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(service.matchFound$.value).toBe(false);
    vi.useRealTimers();
  });
});

function replayMoves(sanMoves: string[]) {
  const chess = new Chess();
  const moves = sanMoves.map((san) => {
    const playerColor = chess.turn() === 'w' ? 'WHITE' : 'BLACK';
    const move = chess.move(san);
    return { from: move.from, to: move.to, promotion: move.promotion, playerColor };
  });
  return { fen: chess.fen(), moves };
}
