import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { GamePageComponent } from './game.page';

function page() {
  const component = Object.create(GamePageComponent.prototype) as GamePageComponent;
  const selectedSquare$ = { value: null as string | null };
  component.botMode = true;
  component.botExecution = 'browser';
  component.botGameActive = true;
  component.botEnabled = true;
  component.botThinking = false;
  component.pendingServerMove = false;
  component.playerColor = 'w';
  component.botColor = 'b';
  component.botElo = 1200;
  component.serverGame = null;
  component.multiplayerHistoryMoves = [];
  component.multiplayerReviewedGameId = null;
  component.multiplayerReplay = null;
  component.multiplayerReplayError = false;
  (component as any).onlineAutoConnected = false;
  (component as any).destroyed = false;
  (component as any).state = {
    sideToMove$: { value: 'w' }, fen$: { value: 'start' }, selectedSquare$,
    positionStatus$: { value: 'NORMAL' },
    status$: { next: vi.fn() },
    isGameOver: () => false, outcome: () => null, reset: vi.fn(), loadExternalState: vi.fn(),
    selectSquare: vi.fn(), clearSelection: vi.fn(() => { selectedSquare$.value = null; }),
    attemptMove: vi.fn().mockReturnValue(true)
  };
  (component as any).botEngine = { stop: vi.fn() };
  (component as any).analysis = {
    stop: vi.fn(), useLocalAnalysis: vi.fn(), applyExternalAnalysis: vi.fn(),
    enabled$: { next: vi.fn() }, scheduleAnalyze: vi.fn()
  };
  (component as any).cdr = { markForCheck: vi.fn() };
  (component as any).multiplayer = {
    connected$: { value: false }, connectionState$: { value: 'READY' },
    gameState$: { value: null }, yourColor$: { value: 'WHITE' },
    queueState$: { value: 'IDLE' }, matchFound$: { value: false },
    activeRoomCode$: { value: null },
    opponentDisconnected$: { value: false }, makeMove: vi.fn(), connect: vi.fn(), listRooms: vi.fn(),
    leaveGame: vi.fn(), leaveRoom: vi.fn(), disconnect: vi.fn(), clearLastError: vi.fn()
  };
  (component as any).engineApi = { authenticated: false };
  vi.spyOn(component, 'maybeBotMove').mockResolvedValue(undefined);
  vi.spyOn(component, 'syncAnalysisSetting').mockImplementation(() => {});
  return component;
}

describe('bot board and color regression', () => {
  it('disconnects from an active online game without abandoning recoverable state', () => {
    const component = page();
    const game = { gameId: 'recoverable', result: 'ONGOING' };
    const multiplayer = (component as any).multiplayer;
    multiplayer.connected$.value = true;
    multiplayer.gameState$.value = game;
    (component as any).onlineAutoConnected = true;

    (component as any).disconnectOnlineSession();

    expect(multiplayer.disconnect).toHaveBeenCalledOnce();
    expect(multiplayer.leaveGame).not.toHaveBeenCalled();
    expect(multiplayer.leaveRoom).not.toHaveBeenCalled();
    expect(multiplayer.gameState$.value).toBe(game);
    expect((component as any).onlineAutoConnected).toBe(false);
  });

  it('leaves a lobby room when exiting without an ongoing game', () => {
    const component = page();
    const multiplayer = (component as any).multiplayer;
    multiplayer.connected$.value = true;
    multiplayer.activeRoomCode$.value = 'ROOM1';

    (component as any).disconnectOnlineSession();

    expect(multiplayer.leaveRoom).toHaveBeenCalledOnce();
    expect(multiplayer.disconnect).toHaveBeenCalledOnce();
    expect(multiplayer.leaveGame).not.toHaveBeenCalled();
  });

  it('hides the duplicate idle Connected row but keeps actionable multiplayer status', () => {
    const component = page();
    component.onlineMode = true;
    const multiplayer = (component as any).multiplayer;

    expect(component.showOnlineBoardStatus()).toBe(false);
    multiplayer.queueState$.value = 'QUEUED';
    expect(component.showOnlineBoardStatus()).toBe(true);
    multiplayer.queueState$.value = 'IDLE';
    multiplayer.activeRoomCode$.value = 'PRIV01';
    expect(component.showOnlineBoardStatus()).toBe(true);
    multiplayer.activeRoomCode$.value = null;
    multiplayer.connectionState$.value = 'RECONNECTING';
    expect(component.showOnlineBoardStatus()).toBe(true);
    multiplayer.connectionState$.value = 'READY';
    expect(component.showOnlineBoardStatus()).toBe(false);
  });

  it('maps lobby, queue, authoritative match, reconnect and active play to truthful animation states', () => {
    const component = page();
    expect(component.chessArenaState()).toBe('LOBBY');

    (component as any).multiplayer.queueState$.value = 'QUEUED';
    expect(component.chessArenaState()).toBe('WAITING_FOR_OPPONENT');

    (component as any).multiplayer.matchFound$.value = true;
    expect(component.chessArenaState()).toBe('MATCH_FOUND');

    (component as any).multiplayer.matchFound$.value = false;
    (component as any).multiplayer.gameState$.value = { gameId: 'active-game' };
    expect(component.chessArenaState()).toBe('ACTIVE_GAME');

    (component as any).multiplayer.connectionState$.value = 'RECONNECTING';
    expect(component.chessArenaState()).toBe('RECONNECTING');
    (component as any).multiplayer.connectionState$.value = 'RECOVERING_GAME';
    expect(component.chessArenaState()).toBe('RECONNECTING');
  });

  it('keeps the board unobscured while the bot thinks and blocks human moves', () => {
    const component = page();
    component.botThinking = true;
    expect(component.canHumanMove()).toBe(false);
    component.botThinking = false;
    expect(component.canHumanMove()).toBe(true);
    component.pendingServerMove = true;
    expect(component.canHumanMove()).toBe(false);
  });

  it('keeps the online setup board visible while blocking moves until an authoritative game is ready', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    expect(component.canHumanMove()).toBe(false);

    (component as any).multiplayer.gameState$.value = {
      gameId: 'match', result: 'ONGOING', sideToMove: 'WHITE'
    };
    expect(component.canHumanMove()).toBe(true);

    (component as any).multiplayer.yourColor$.value = null;
    expect(component.canHumanMove()).toBe(false);
    (component as any).multiplayer.yourColor$.value = 'WHITE';

    (component as any).multiplayer.connectionState$.value = 'RECONNECTING';
    expect(component.canHumanMove()).toBe(false);
  });

  it('reconnects after a deliberate disconnect and avoids duplicate connection attempts', () => {
    const component = page();
    const multiplayer = (component as any).multiplayer;
    component.onlineMode = true;
    multiplayer.connected$.value = true;
    multiplayer.gameState$.value = { gameId: 'online', result: 'ONGOING' };
    (component as any).onlineAutoConnected = true;

    (component as any).disconnectOnlineSession();
    multiplayer.connected$.value = false;
    (component as any).ensureOnlineConnected();
    (component as any).ensureOnlineConnected();

    expect(multiplayer.connect).toHaveBeenCalledOnce();
    expect(multiplayer.listRooms).toHaveBeenCalledOnce();
    expect((component as any).onlineAutoConnected).toBe(true);
  });

  it('does not connect while outside online mode or after the component is destroyed', () => {
    const component = page();
    const multiplayer = (component as any).multiplayer;

    (component as any).ensureOnlineConnected();
    component.onlineMode = true;
    (component as any).destroyed = true;
    (component as any).ensureOnlineConnected();

    expect(multiplayer.connect).not.toHaveBeenCalled();
    expect(multiplayer.listRooms).not.toHaveBeenCalled();
    expect((component as any).onlineAutoConnected).toBe(false);
  });

  it('restores the retained authoritative snapshot over the bot board', () => {
    const component = page();
    const chess = new Chess();
    chess.move('e4');
    chess.move('e5');
    const game = {
      gameId: 'online-game', fen: chess.fen(), sideToMove: 'WHITE', result: 'ONGOING', endReason: 'NONE',
      moves: chess.history({ verbose: true }).map(move => ({
        from: move.from, to: move.to, promotion: move.promotion ?? null,
        playerColor: move.color === 'w' ? 'WHITE' : 'BLACK'
      })), whiteTimeLeftMs: 310000, blackTimeLeftMs: 320000, version: 2
    } as any;
    const loadedMoves = [{ san: 'e4', from: 'e2', to: 'e4' }, { san: 'e5', from: 'e7', to: 'e5' }];
    const state = (component as any).state;
    state.fen$.value = new Chess().fen();
    state.loadExternalState.mockImplementation((fen: string) => {
      state.fen$.value = fen;
      return loadedMoves;
    });
    (component as any).multiplayer.gameState$.value = game;

    (component as any).restoreMultiplayerBoardFromSnapshot();

    expect(state.loadExternalState).toHaveBeenCalledWith(game.fen, game.moves, 'w');
    expect(state.fen$.value).toBe(game.fen);
    expect(component.multiplayerHistoryMoves).toEqual(loadedMoves);
  });

  it('keeps the retained multiplayer board non-interactive after reconnect failure', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    (component as any).multiplayer.gameState$.value = {
      gameId: 'online', result: 'ONGOING', sideToMove: 'WHITE'
    };
    (component as any).multiplayer.connectionState$.value = 'ERROR';

    component.onSquareClick('e2');

    expect(component.canHumanMove()).toBe(false);
    expect((component as any).state.selectSquare).not.toHaveBeenCalled();
    expect((component as any).multiplayer.gameState$.value.gameId).toBe('online');
  });

  it('clears analysis and never starts or applies engine hints for multiplayer state', () => {
    const component = page();
    component.evalHistory = [0.3, -0.2];

    (component as any).clearMultiplayerAnalysis();

    expect((component as any).analysis.useLocalAnalysis).toHaveBeenCalledOnce();
    expect((component as any).analysis.scheduleAnalyze).not.toHaveBeenCalled();
    expect((component as any).analysis.applyExternalAnalysis).not.toHaveBeenCalled();
    expect(component.evalHistory).toEqual([]);
  });

  it('blocks spectators and players who are not on move before selecting a square', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    (component as any).multiplayer.gameState$.value = {
      gameId: 'match', result: 'ONGOING', sideToMove: 'BLACK'
    };

    component.onSquareClick('e2');
    expect((component as any).state.selectSquare).not.toHaveBeenCalled();

    (component as any).multiplayer.yourColor$.value = null;
    (component as any).multiplayer.gameState$.value.sideToMove = 'WHITE';
    component.onSquareClick('e2');
    expect((component as any).state.selectSquare).not.toHaveBeenCalled();
  });

  it('allows selection and sends a move only during the assigned player turn', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    (component as any).multiplayer.gameState$.value = {
      gameId: 'match', result: 'ONGOING', sideToMove: 'WHITE'
    };

    component.onSquareClick('e2');
    expect((component as any).state.selectSquare).toHaveBeenCalledWith('e2');
    (component as any).state.selectedSquare$.value = 'e2';
    component.onSquareClick('e4');

    expect((component as any).multiplayer.makeMove).toHaveBeenCalledWith('match', { from: 'e2', to: 'e4' });
    expect(component.pendingServerMove).toBe(true);
    expect(component.canHumanMove()).toBe(false);
  });

  it('submits a promotion only while the player remains authorized to move', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    component.pendingPromotion = { from: 'a7', to: 'a8' };
    (component as any).multiplayer.gameState$.value = {
      gameId: 'match', result: 'ONGOING', sideToMove: 'WHITE'
    };

    component.choosePromotion('q');

    expect((component as any).multiplayer.makeMove).toHaveBeenCalledWith('match', {
      from: 'a7', to: 'a8', promotion: 'q'
    });
    expect(component.pendingServerMove).toBe(true);
    expect(component.pendingPromotion).toBeNull();
  });

  it('clears pending selection and promotion when multiplayer interaction becomes unavailable', () => {
    const component = page();
    component.pendingServerMove = true;
    component.pendingPromotion = { from: 'a7', to: 'a8' };
    (component as any).state.selectedSquare$.value = 'a7';

    (component as any).clearMultiplayerSelection();

    expect(component.pendingServerMove).toBe(false);
    expect(component.pendingPromotion).toBeNull();
    expect((component as any).state.selectedSquare$.value).toBeNull();
  });

  it('reports turn, check, reconnect, disconnect, and terminal multiplayer status', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    component.lang = 'en';
    (component as any).translations = {
      en: {
        yourTurn: 'Your turn', opponentTurn: "Opponent's turn", spectator: 'Spectator',
        checkAlert: 'Check!', reconnecting: 'Reconnecting', gameInProgress: 'Game in progress',
        opponentDisconnected: 'Opponent disconnected', gameFinished: 'Game finished'
      },
      pl: {}
    };
    (component as any).multiplayer.gameState$.value = {
      gameId: 'match', result: 'ONGOING', sideToMove: 'WHITE'
    };

    expect(component.multiplayerTurnLabel()).toBe('Game in progress · Your turn');
    (component as any).multiplayer.gameState$.value.sideToMove = 'BLACK';
    expect(component.multiplayerTurnLabel()).toBe("Game in progress · Opponent's turn");
    (component as any).state.positionStatus$.value = 'CHECK';
    expect(component.multiplayerTurnLabel()).toContain('Check!');

    (component as any).multiplayer.connectionState$.value = 'RECONNECTING';
    expect(component.multiplayerTurnLabel()).toBe(component.t('reconnecting'));
    (component as any).multiplayer.connectionState$.value = 'READY';
    (component as any).multiplayer.opponentDisconnected$.value = true;
    expect(component.multiplayerTurnLabel()).toBe(component.t('opponentDisconnected'));
    (component as any).multiplayer.gameState$.value.result = 'DRAW';
    expect(component.multiplayerTurnLabel()).toBe('Game finished');
  });

  it('assigns the selected color to the human and gives Black to the bot when White is selected', async () => {
    const component = page();
    component.botSideChoice = 'w';
    await component.startBotGame();
    expect(component.playerColor).toBe('w');
    expect(component.botColor).toBe('b');
    expect(component.boardOrientation()).toBe('white');
    expect(component.maybeBotMove).not.toHaveBeenCalled();
  });

  it('lets the bot move first when the human selects Black', async () => {
    const component = page();
    component.botSideChoice = 'b';
    await component.startBotGame();
    expect(component.playerColor).toBe('b');
    expect(component.botColor).toBe('w');
    expect(component.boardOrientation()).toBe('black');
    expect(component.maybeBotMove).toHaveBeenCalledOnce();
  });

  it('keeps the selected sidebar tab during ordinary native snapshots', () => {
    const component = page();
    component.botExecution = 'server';
    component.botSidebarTab = 'moves';
    const game = { gameId: 'one', fen: 'start', sideToMove: 'WHITE', result: 'ONGOING',
      endReason: 'NONE', moves: [], turnState: 'PLAYER_TURN', version: 1,
      playerColor: 'WHITE' } as any;
    (component as any).applyServerBotGame(game);
    expect(component.botSidebarTab).toBe('moves');
    component.botSidebarTab = 'settings';
    (component as any).applyServerBotGame({ ...game, version: 2 });
    expect(component.botSidebarTab).toBe('settings');
  });

  it('keeps one dismissed result for repeated completed native snapshots', () => {
    const component = page();
    component.botExecution = 'server';
    const game = { gameId: 'done', fen: 'start', sideToMove: 'WHITE', result: 'BLACK_WIN',
      endReason: 'RESIGNATION', moves: [], turnState: 'FINISHED', version: 5,
      playerColor: 'WHITE' } as any;
    (component as any).applyServerBotGame(game);
    const outcome = component.botOutcome()!;
    expect(component.botPhase()).toBe('FINISHED');
    expect(outcome.perspective).toBe('LOSS');
    component.reviewBotGame(outcome);
    expect(component.botSidebarTab).toBe('moves');
    (component as any).applyServerBotGame({ ...game, version: 6 });
    expect(component.dismissedOutcomeKey).toBe(component.outcomeKey(component.botOutcome()!));
  });

  it('blocks the multiplayer board and exposes the terminal result after checkmate', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    const chess = new Chess();
    const moves = ['f3', 'e5', 'g4', 'Qh4#'].map(san => chess.move(san));
    (component as any).multiplayer.gameState$.value = {
      gameId: 'online', fen: chess.fen(), sideToMove: 'WHITE', result: 'BLACK_WIN',
      endReason: 'CHECKMATE', moves, whiteTimeLeftMs: 900, blackTimeLeftMs: 1000, version: 42
    };

    expect(component.canHumanMove()).toBe(false);
    expect(component.multiplayerOutcome()).toMatchObject({
      status: 'FINISHED', result: 'BLACK_WIN', perspective: 'LOSS', endReason: 'CHECKMATE', moveCount: 4
    });
  });

  it('keeps spectator results neutral and review dismissed across duplicate snapshots', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    const finalGame = {
      gameId: 'finished', fen: new Chess().fen(), sideToMove: 'WHITE', result: 'WHITE_WIN',
      endReason: 'RESIGNATION', moves: [], whiteTimeLeftMs: 0, blackTimeLeftMs: 0, version: 9
    } as any;
    (component as any).multiplayer.gameState$.value = finalGame;
    (component as any).multiplayer.yourColor$.value = null;

    const outcome = component.multiplayerOutcome()!;
    expect(outcome.perspective).toBe('NEUTRAL');
    component.reviewMultiplayerGame(outcome);
    (component as any).multiplayer.gameState$.value = { ...finalGame, version: 10 };
    expect(component.isReviewingMultiplayerGame()).toBe(true);
    (component as any).multiplayer.gameState$.value = { ...finalGame, gameId: 'next-game' };
    expect(component.isReviewingMultiplayerGame()).toBe(false);
  });

  it('replays a completed multiplayer board without changing its authoritative state', () => {
    const component = page();
    component.botMode = false;
    component.onlineMode = true;
    const chess = new Chess();
    for (const san of ['e4', 'e5']) chess.move(san);
    const moves = chess.history({ verbose: true }).map(move => ({
      from: move.from, to: move.to, promotion: move.promotion
    }));
    const game = {
      gameId: 'finished', fen: chess.fen(), sideToMove: 'WHITE', result: 'DRAW',
      endReason: 'AGREEMENT', moves, whiteTimeLeftMs: 0, blackTimeLeftMs: 0, version: 10
    } as any;
    (component as any).multiplayer.gameState$.value = game;
    (component as any).state.fen$.value = game.fen;

    component.reviewMultiplayerGame(component.multiplayerOutcome()!);
    const authoritativeFen = (component as any).multiplayer.gameState$.value.fen;
    expect(component.multiplayerReplay?.positionIndex).toBe(2);

    component.setMultiplayerReplayPosition(0);
    expect(component.boardFen(authoritativeFen)).toBe(new Chess().fen());
    expect(component.boardLastMove({ san: 'e5', from: 'e7', to: 'e5' })).toBeNull();
    expect((component as any).multiplayer.gameState$.value.fen).toBe(authoritativeFen);

    component.setMultiplayerReplayPosition(1);
    const afterWhiteMove = new Chess();
    afterWhiteMove.move('e4');
    expect(component.boardFen(authoritativeFen)).toBe(afterWhiteMove.fen());
    expect(component.boardLastMove(null)?.san).toBe('e4');
    component.setMultiplayerReplayPosition(2);
    expect(component.boardFen(authoritativeFen)).toBe(authoritativeFen);
    expect(component.multiplayerReplay?.activeMoveIndex).toBe(1);
  });
});
