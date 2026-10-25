import { describe, expect, it, vi } from 'vitest';
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
    isGameOver: () => false, reset: vi.fn()
  };
  (component as any).botEngine = { stop: vi.fn() };
  (component as any).analysis = { stop: vi.fn(), enabled$: { next: vi.fn() }, scheduleAnalyze: vi.fn() };
  (component as any).multiplayer = { connected$: { value: false }, gameState$: { value: null } };
  (component as any).engineApi = { authenticated: false };
  vi.spyOn(component, 'maybeBotMove').mockResolvedValue(undefined);
  vi.spyOn(component, 'syncAnalysisSetting').mockImplementation(() => {});
  return component;
}

describe('bot board and color regression', () => {
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
});
