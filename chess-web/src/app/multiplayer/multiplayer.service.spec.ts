import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { MultiplayerService } from './multiplayer.service';
import { multiplayerOutcome } from '../game/game-outcome';

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

  it('applies a canonical terminal snapshot after moveAccepted at the same version', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);

    (service as any).handleMoveAccepted(fixture.moveAccepted);
    expect(service.gameState$.value).toMatchObject({ version: 4, result: 'ONGOING' });
    (service as any).handleGameEnded(fixture.gameEnded);

    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('allows a valid same-version terminal gameStateSync after moveAccepted', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    (service as any).handleMoveAccepted(fixture.moveAccepted);

    (service as any).handleGameStateSync({ state: fixture.finalSnapshot });

    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('keeps a terminal snapshot when gameEnded arrives before moveAccepted', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    const requestSync = vi.spyOn(service, 'requestSync');
    (service as any).handleGameEnded(fixture.gameEnded);
    const terminal = service.gameState$.value;

    (service as any).handleMoveAccepted(fixture.moveAccepted);

    expect(service.gameState$.value).toBe(terminal);
    expect(requestSync).not.toHaveBeenCalled();
    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('treats terminal gameStateSync followed by gameEnded as one outcome', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    (service as any).handleGameStateSync({ state: fixture.finalSnapshot });
    const terminal = service.gameState$.value;

    (service as any).handleGameEnded(fixture.gameEnded);

    expect(service.gameState$.value).toBe(terminal);
    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('treats gameEnded followed by terminal gameStateSync as one outcome', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    (service as any).handleGameEnded(fixture.gameEnded);
    const terminal = service.gameState$.value;

    (service as any).handleGameStateSync({ state: fixture.finalSnapshot });

    expect(service.gameState$.value).toBe(terminal);
    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('ignores duplicate moveAccepted and gameEnded events without re-emitting state', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    const stateChanges = vi.fn();
    service.gameState$.subscribe(stateChanges);

    (service as any).handleMoveAccepted(fixture.moveAccepted);
    const afterMove = service.gameState$.value;
    (service as any).handleMoveAccepted(fixture.moveAccepted);
    expect(service.gameState$.value).toBe(afterMove);

    (service as any).handleGameEnded(fixture.gameEnded);
    const afterEnd = service.gameState$.value;
    (service as any).handleGameEnded(fixture.gameEnded);

    expect(service.gameState$.value).toBe(afterEnd);
    expect(stateChanges).toHaveBeenCalledTimes(3);
    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('ignores an older moveAccepted after the game has ended', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    const requestSync = vi.spyOn(service, 'requestSync');
    (service as any).handleGameEnded(fixture.gameEnded);
    const terminal = service.gameState$.value;

    (service as any).handleMoveAccepted({ ...fixture.moveAccepted, version: 3 });

    expect(service.gameState$.value).toBe(terminal);
    expect(requestSync).not.toHaveBeenCalled();
    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('completes reconnect when the existing terminal snapshot is replayed', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.finalSnapshot);
    (service as any).awaitingRecoverySnapshot = true;
    service.connectionState$.next('RECOVERING_GAME');
    service.ready$.next(false);

    (service as any).handleGameStateSync({ state: fixture.finalSnapshot });

    expect(service.gameState$.value).toBe(fixture.finalSnapshot);
    expect(service.connectionState$.value).toBe('READY');
    expect(service.ready$.value).toBe(true);
    expect((service as any).awaitingRecoverySnapshot).toBe(false);
  });

  it('requests a resync for a same-version contradiction and never regresses a finished game', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    const requestSync = vi.spyOn(service, 'requestSync');
    (service as any).handleGameEnded(fixture.gameEnded);
    const terminal = service.gameState$.value;

    (service as any).handleGameStateSync({ state: {
      ...fixture.finalSnapshot, result: 'ONGOING', endReason: 'NONE'
    } });

    expect(service.gameState$.value).toBe(terminal);
    expect(service.lastError$.value).toBe('state_conflict');
    expect(requestSync).toHaveBeenCalledWith('game-1');
    expectTerminalResult(service, fixture.finalSnapshot.fen);
  });

  it('rejects same-version finality that cannot be caused by the accepted move', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    const requestSync = vi.spyOn(service, 'requestSync');
    (service as any).handleMoveAccepted(fixture.moveAccepted);
    const moveState = service.gameState$.value;

    (service as any).handleGameStateSync({ state: {
      ...fixture.finalSnapshot, endReason: 'RESIGNATION'
    } });

    expect(service.gameState$.value).toBe(moveState);
    expect(service.lastError$.value).toBe('state_conflict');
    expect(requestSync).toHaveBeenCalledWith('game-1');
  });

  it('requests a snapshot instead of guessing a missing move version', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    const requestSync = vi.spyOn(service, 'requestSync');

    (service as any).handleMoveAccepted({ ...fixture.moveAccepted, version: undefined });

    expect(service.gameState$.value).toBe(fixture.initial);
    expect(service.lastError$.value).toBe('state_conflict');
    expect(requestSync).toHaveBeenCalledWith('game-1');
  });

  it('does not publish a move for a finished multiplayer game', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.finalSnapshot);
    service.connectionState$.next('READY');
    service.ready$.next(true);
    const send = vi.spyOn(service as any, 'send');

    service.makeMove('game-1', { from: 'a2', to: 'a3' });

    expect(send).not.toHaveBeenCalled();
  });

  it('cleans up a closed room once and keeps the reason for the user', () => {
    const service = new MultiplayerService();
    service.activeRoomCode$.next('ROOM1');
    service.roomCode$.next('ROOM1');
    const unsubscribeRoom = vi.fn();
    (service as any).roomSubscription = { unsubscribe: unsubscribeRoom };
    (service as any).roomSubscriptionCode = 'ROOM1';
    const payload = {
      roomCode: 'ROOM1', type: 'ROOM_CLOSED', roomStatus: 'CLOSED',
      closeReason: 'HOST_DISCONNECTED', occurredAt: '2026-10-27T12:00:00Z'
    };
    const deliver = () => (service as any).handleMessage({
      body: JSON.stringify({ type: 'roomClosed', payload })
    });

    deliver();
    deliver();

    expect(service.activeRoomCode$.value).toBeNull();
    expect(service.roomCode$.value).toBeNull();
    expect(service.lastError$.value).toBe('room_closed_host_disconnected');
    expect(unsubscribeRoom).toHaveBeenCalledOnce();
  });

  it('recovers a missed closure from the authoritative room participant snapshot', () => {
    const service = new MultiplayerService();
    service.activeRoomCode$.next('ROOM1');
    service.roomCode$.next('ROOM1');
    (service as any).handleMessage({ body: JSON.stringify({ type: 'roomParticipants', payload: {
      roomCode: 'ROOM1', participants: [], roomStatus: 'CLOSED', closeReason: 'HOST_DELETED',
      memberEvent: 'ROOM_CLOSED', lifecycleAt: '2026-10-27T12:00:00Z'
    } }) });

    expect(service.activeRoomCode$.value).toBeNull();
    expect(service.lastError$.value).toBe('room_closed_host_deleted');
  });

  it('retains and rotates a private room recovery credential across reconnect events', () => {
    window.sessionStorage.removeItem('roomReconnectToken');
    window.sessionStorage.removeItem('roomRecoveryRoomCode');
    const service = new MultiplayerService();
    (service as any).handleMessage({ body: JSON.stringify({ type: 'roomRecovery', payload: {
      roomCode: 'PRIV01', reconnectToken: 'room-token-1'
    } }) });
    expect(service.activeRoomCode$.value).toBe('PRIV01');
    expect((service as any).currentRoomReconnectToken).toBe('room-token-1');

    (service as any).handleMessage({ body: JSON.stringify({ type: 'helloAck', payload: {
      username: 'Guest', userId: 12, roomReconnectToken: 'room-token-2'
    } }) });
    expect((service as any).currentRoomReconnectToken).toBe('room-token-2');

    const restoredService = new MultiplayerService();
    expect(restoredService.activeRoomCode$.value).toBe('PRIV01');
    expect((restoredService as any).currentRoomReconnectToken).toBe('room-token-2');

    (service as any).handleRoomTerminal('roomClosed', {
      roomCode: 'PRIV01', type: 'ROOM_CLOSED', closeReason: 'HOST_DELETED'
    });
    expect((service as any).currentRoomReconnectToken).toBeNull();
    expect(window.sessionStorage.getItem('roomReconnectToken')).toBeNull();
    expect(window.sessionStorage.getItem('roomRecoveryRoomCode')).toBeNull();
  });

  it('acknowledges a rotated reconnect token and retries when helloAck is lost', () => {
    vi.useFakeTimers();
    try {
      const service = new MultiplayerService();
      const publish = vi.fn();
      const forceDisconnect = vi.fn();
      const deactivate = vi.fn().mockResolvedValue(undefined);
      (service as any).client = { connected: true, active: true, publish, forceDisconnect, deactivate };
      (service as any).awaitingHelloAck = true;

      (service as any).scheduleHelloAckTimeout();
      vi.advanceTimersByTime(5000);
      expect(forceDisconnect).toHaveBeenCalledOnce();

      (service as any).handleMessage({ body: JSON.stringify({ type: 'helloAck', payload: {
        username: 'Player', userId: 7, gameId: 'game-7', reconnectToken: 'rotated-token',
        reconnectAckId: 'rotation-ack'
      } }) });

      expect(publish).toHaveBeenCalledWith(expect.objectContaining({
        destination: '/app/ackReconnect',
        body: JSON.stringify({ gameId: 'game-7', ackId: 'rotation-ack' })
      }));
      expect((service as any).currentReconnectToken).toBe('rotated-token');
      expect((service as any).helloAckRetries).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts chess.js and backend en-passant notation for the current position', () => {
    const service = new MultiplayerService();
    const available = replayMoves(['e4', 'a6', 'e5', 'd5']);
    expect((service as any).isValidGameSnapshot(snapshotFor(available))).toBe(true);

    const noCaptureAvailable = replayMoves(['e4', 'a6']);
    const forcedEnPassant = new Chess(noCaptureAvailable.fen).fen({ forceEnpassantSquare: true });
    expect((service as any).isValidGameSnapshot(snapshotFor(noCaptureAvailable, { fen: forcedEnPassant }))).toBe(true);
  });

  it('rejects historical en-passant permission for a later unrelated position', () => {
    const service = new MultiplayerService();
    const playedEnPassant = replayMoves(['e4', 'a6', 'e5', 'd5', 'exd6', 'a5']);
    const corruptedFields = playedEnPassant.fen.split(' ');
    corruptedFields[3] = 'd6';

    expect((service as any).isValidGameSnapshot(snapshotFor(playedEnPassant, {
      fen: corruptedFields.join(' ')
    }))).toBe(false);
  });

  it('rejects illegal or truncated move history, castling changes, and bad results', () => {
    const service = new MultiplayerService();
    const played = replayMoves(['e4', 'e5', 'Nf3', 'Nc6']);
    const base = snapshotFor(played);
    expect((service as any).isValidGameSnapshot({ ...base, moves: [...base.moves.slice(0, 3)] })).toBe(false);
    expect((service as any).isValidGameSnapshot({ ...base, version: base.version + 5 })).toBe(false);
    expect((service as any).isValidGameSnapshot({ ...base, moves: [
      ...base.moves.slice(0, 3), { from: 'e7', to: 'e4', playerColor: 'BLACK' }
    ] })).toBe(false);

    const badCastling = base.fen.split(' ');
    badCastling[2] = '-';
    expect((service as any).isValidGameSnapshot({ ...base, fen: badCastling.join(' ') })).toBe(false);

    const mate = replayMoves(['f3', 'e5', 'g4', 'Qh4#']);
    expect((service as any).isValidGameSnapshot(snapshotFor(mate, {
      result: 'DRAW', endReason: 'CHECKMATE'
    }))).toBe(false);
  });

  it('bounds repeated invalid snapshot resynchronization without changing the valid board', () => {
    const fixture = foolsMateFixture();
    const service = serviceWithState(fixture.initial);
    const requestSync = vi.spyOn(service, 'requestSync');
    const current = service.gameState$.value;
    const corrupted = { ...fixture.initial, fen: 'invalid-fen' };

    for (let index = 0; index < 8; index++) {
      (service as any).handleGameStateSync({ state: corrupted });
    }

    expect(service.gameState$.value).toBe(current);
    expect(requestSync).toHaveBeenCalledTimes(3);
    expect(service.lastError$.value).toBe('snapshot_recovery_failed');
  });

  it('does not clear an unrelated active game or treat game completion as room closure', () => {
    const service = new MultiplayerService();
    const activeGame = { gameId: 'game-1', result: 'ONGOING' } as any;
    service.activeRoomCode$.next('ROOM2');
    service.roomCode$.next('ROOM2');
    service.gameState$.next(activeGame);
    (service as any).currentGameId = 'game-1';

    (service as any).handleMessage({ body: JSON.stringify({ type: 'roomClosed', payload: {
      roomCode: 'ROOM1', type: 'ROOM_CLOSED', roomStatus: 'CLOSED', closeReason: 'HOST_DELETED'
    } }) });
    (service as any).handleMessage({ body: JSON.stringify({ type: 'roomParticipants', payload: {
      roomCode: 'ROOM2', participants: [], roomStatus: 'CLOSED', closeReason: 'GAME_FINISHED',
      memberEvent: 'ROOM_OPEN'
    } }) });

    expect(service.activeRoomCode$.value).toBe('ROOM2');
    expect(service.gameState$.value).toBe(activeGame);
    expect(service.lastError$.value).toBeNull();
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
    expect(service.lastError$.value).toBe('state_conflict');
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

  it('ignores duplicate gameStarted events without resetting board history or rolling back the reconnect token', () => {
    const service = new MultiplayerService();
    const current = replayMoves(['e4']);
    service.gameState$.next({
      gameId: 'game-1', fen: current.fen, sideToMove: 'BLACK', result: 'ONGOING', endReason: 'NONE',
      moves: current.moves, whiteTimeLeftMs: 9000, blackTimeLeftMs: 9000, version: 1
    } as any);
    (service as any).currentGameId = 'game-1';
    (service as any).currentReconnectToken = 'latest-token';
    service.reconnectToken$.next('latest-token');
    const subscribe = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });
    (service as any).client = { subscribe };

    (service as any).handleGameStarted({
      gameId: 'game-1', fen: new Chess().fen(), sideToMove: 'WHITE', timeControlType: 'RAPID',
      whiteTimeLeftMs: 10000, blackTimeLeftMs: 10000, yourColor: 'WHITE', reconnectToken: 'stale-token'
    });

    expect(service.gameState$.value?.moves).toEqual(current.moves);
    expect(service.gameState$.value?.fen).toBe(current.fen);
    expect(service.reconnectToken$.value).toBe('latest-token');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('shows the match-found transition only after a real gameStarted event', () => {
    vi.useFakeTimers();
    try {
      const service = new MultiplayerService();
      expect(service.matchFound$.value).toBe(false);
      (service as any).handleGameStarted({
        gameId: 'invalid-match', fen: 'corrupt', sideToMove: 'WHITE', timeControlType: 'RAPID',
        whiteTimeLeftMs: 60000, blackTimeLeftMs: 60000, yourColor: 'WHITE', reconnectToken: 'bad-token', version: 0
      });
      expect(service.matchFound$.value).toBe(false);

      const started = {
        gameId: 'game-match', fen: new Chess().fen(), sideToMove: 'WHITE', timeControlType: 'RAPID' as const,
        whiteTimeLeftMs: 60000, blackTimeLeftMs: 60000, yourColor: 'WHITE' as const,
        reconnectToken: 'token', version: 0
      };
      (service as any).handleGameStarted(started);
      expect(service.matchFound$.value).toBe(true);

      vi.advanceTimersByTime(700);
      (service as any).handleGameStarted({ ...started, reconnectToken: 'stale-token' });
      expect(service.matchFound$.value).toBe(true);
      vi.advanceTimersByTime(900);
      expect(service.matchFound$.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

function serviceWithState(state: any) {
  const service = new MultiplayerService();
  service.gameState$.next(state);
  return service;
}

function foolsMateFixture() {
  const prefix = replayMoves(['f3', 'e5', 'g4']);
  const final = replayMoves(['f3', 'e5', 'g4', 'Qh4#']);
  const lastMoveAt = '2026-10-27T12:00:00Z';
  const initial = {
    gameId: 'game-1', fen: prefix.fen, sideToMove: 'BLACK', yourColor: 'WHITE',
    roomCode: 'ROOM1', timeControlType: 'BLITZ', result: 'ONGOING', endReason: 'NONE',
    moves: prefix.moves, whiteTimeLeftMs: 1000, blackTimeLeftMs: 1000,
    lastMoveAt: '2026-10-27T11:59:59Z', version: 3
  };
  const moveAccepted = {
    gameId: 'game-1', move: final.moves[3], fen: final.fen, sideToMove: 'WHITE',
    whiteTimeLeftMs: 950, blackTimeLeftMs: 1000, lastMoveAt, version: 4
  };
  const finalSnapshot = {
    ...initial, fen: final.fen, sideToMove: 'WHITE', result: 'BLACK_WIN', endReason: 'CHECKMATE',
    moves: final.moves, whiteTimeLeftMs: 950, blackTimeLeftMs: 1000, lastMoveAt, version: 4
  };
  const gameEnded = {
    gameId: 'game-1', result: 'BLACK_WIN', endReason: 'CHECKMATE', fen: final.fen,
    sideToMove: 'WHITE', whiteTimeLeftMs: 950, blackTimeLeftMs: 1000,
    version: 4, moves: final.moves
  };
  return { initial, moveAccepted, gameEnded, finalSnapshot };
}

function expectTerminalResult(service: MultiplayerService, fen: string) {
  const state = service.gameState$.value!;
  expect(state).toMatchObject({
    version: 4, result: 'BLACK_WIN', endReason: 'CHECKMATE', fen,
    sideToMove: 'WHITE', whiteTimeLeftMs: 950, blackTimeLeftMs: 1000,
    moves: replayMoves(['f3', 'e5', 'g4', 'Qh4#']).moves
  });
  expect(multiplayerOutcome(state, 'WHITE')).toMatchObject({
    status: 'FINISHED', result: 'BLACK_WIN', perspective: 'LOSS', endReason: 'CHECKMATE',
    finalFen: fen, moveCount: 4
  });
}

function replayMoves(sanMoves: string[]) {
  const chess = new Chess();
  const moves = sanMoves.map((san) => {
    const playerColor = chess.turn() === 'w' ? 'WHITE' : 'BLACK';
    const move = chess.move(san);
    return { from: move.from, to: move.to, promotion: move.promotion, playerColor };
  });
  return { fen: chess.fen(), moves };
}

function snapshotFor(replay: { fen: string; moves: any[] }, overrides: Record<string, unknown> = {}) {
  const chess = new Chess(replay.fen);
  return {
    gameId: 'snapshot-test',
    fen: replay.fen,
    sideToMove: chess.turn() === 'w' ? 'WHITE' : 'BLACK',
    timeControlType: 'RAPID',
    result: 'ONGOING',
    endReason: 'NONE',
    moves: replay.moves,
    whiteTimeLeftMs: 60_000,
    blackTimeLeftMs: 60_000,
    version: replay.moves.length,
    ...overrides
  };
}
