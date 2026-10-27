import { describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { GamePageComponent } from './game.page';

function page() {
  const component = Object.create(GamePageComponent.prototype) as GamePageComponent;
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
    sideToMove$: { value: 'w' }, fen$: { value: 'start' },
    status$: { next: vi.fn() },
    isGameOver: () => false, outcome: () => null, reset: vi.fn(), loadExternalState: vi.fn()
  };
  (component as any).botEngine = { stop: vi.fn() };
  (component as any).analysis = { stop: vi.fn(), enabled$: { next: vi.fn() }, scheduleAnalyze: vi.fn() };
  (component as any).cdr = { markForCheck: vi.fn() };
  (component as any).multiplayer = {
    connected$: { value: false }, connectionState$: { value: 'READY' },
    gameState$: { value: null }, yourColor$: { value: 'WHITE' },
    queueState$: { value: 'IDLE' }, matchFound$: { value: false }
  };
  (component as any).engineApi = { authenticated: false };
  vi.spyOn(component, 'maybeBotMove').mockResolvedValue(undefined);
  vi.spyOn(component, 'syncAnalysisSetting').mockImplementation(() => {});
  return component;
}

describe('bot board and color regression', () => {
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

  it('explains that an unverifiable recovered snapshot leaves the current board untouched', () => {
    const component = page();
    (component as any).translations = {
      en: { snapshotRecoveryFailed: 'Your current board was kept.' },
      pl: { snapshotRecoveryFailed: 'Zachowano obecna plansze.' }
    };
    component.lang = 'en';
    expect(component.onlineErrorMessage('snapshot_recovery_failed'))
      .toContain('Your current board was kept');
  });

  it('localizes multiplayer recovery errors using the selected language', () => {
    const component = page();
    (component as any).translations = {
      en: { snapshotRecoveryFailed: 'Your current board was kept.' },
      pl: { snapshotRecoveryFailed: 'Zachowano obecna plansze.' }
    };
    component.lang = 'pl';
    expect(component.onlineErrorMessage('snapshot_recovery_failed')).toBe('Zachowano obecna plansze.');
  });

  it('keeps the board unobscured while the bot thinks and blocks human moves', () => {
    const component = page();
    component.botThinking = true;
    expect(component.shouldShowPreGameOverlay()).toBe(false);
    expect(component.canHumanMove()).toBe(false);
    component.botThinking = false;
    expect(component.canHumanMove()).toBe(true);
    component.pendingServerMove = true;
    expect(component.canHumanMove()).toBe(false);
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
});
