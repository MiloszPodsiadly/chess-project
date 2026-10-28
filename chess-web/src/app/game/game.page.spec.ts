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
  (component as any).state = {
    sideToMove$: { value: 'w' }, fen$: { value: 'start' }, selectedSquare$,
    positionStatus$: { value: 'NORMAL' },
    status$: { next: vi.fn() },
    isGameOver: () => false, outcome: () => null, reset: vi.fn(), loadExternalState: vi.fn(),
    selectSquare: vi.fn(), clearSelection: vi.fn(() => { selectedSquare$.value = null; }),
    attemptMove: vi.fn().mockReturnValue(true)
  };
  (component as any).botEngine = { stop: vi.fn() };
  (component as any).analysis = { stop: vi.fn(), enabled$: { next: vi.fn() }, scheduleAnalyze: vi.fn() };
  (component as any).cdr = { markForCheck: vi.fn() };
  (component as any).multiplayer = {
    connected$: { value: false }, connectionState$: { value: 'READY' },
    gameState$: { value: null }, yourColor$: { value: 'WHITE' },
    queueState$: { value: 'IDLE' }, matchFound$: { value: false },
    activeRoomCode$: { value: null },
    opponentDisconnected$: { value: false }, makeMove: vi.fn()
  };
  (component as any).engineApi = { authenticated: false };
  vi.spyOn(component, 'maybeBotMove').mockResolvedValue(undefined);
  vi.spyOn(component, 'syncAnalysisSetting').mockImplementation(() => {});
  return component;
}

describe('bot board and color regression', () => {
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
      gameId: 'finished', fen: 'start', sideToMove: 'WHITE', result: 'WHITE_WIN',
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
});
