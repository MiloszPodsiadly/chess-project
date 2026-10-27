import { describe, expect, it } from 'vitest';
import { GameOutcome } from '../game-outcome';
import { GameResultPanelComponent } from './game-result-panel.component';

function outcome(result: GameOutcome['result'], perspective: GameOutcome['perspective'],
                 endReason: GameOutcome['endReason']): GameOutcome {
  return { status: 'FINISHED', gameId: 'one', result, perspective, endReason,
    winnerColor: result === 'DRAW' ? null : result === 'WHITE_WIN' ? 'WHITE' : 'BLACK',
    finalFen: '', moveCount: 42 };
}

describe('GameResultPanelComponent', () => {
  it('shows the right score and title for victory, defeat and draw', () => {
    const panel = new GameResultPanelComponent();
    panel.outcome = outcome('WHITE_WIN', 'WIN', 'CHECKMATE');
    expect(panel.title).toBe('Victory!');
    expect(panel.notation).toBe('1–0');
    panel.outcome = outcome('BLACK_WIN', 'LOSS', 'RESIGNATION');
    expect(panel.title).toBe('Defeat');
    expect(panel.notation).toBe('0–1');
    panel.lang = 'pl';
    panel.outcome = outcome('DRAW', 'DRAW', 'STALEMATE');
    expect(panel.title).toBe('Remis');
    expect(panel.reason).toBe('Pat');
    expect(panel.notation).toBe('½–½');
  });

  it('uses a neutral title for spectators', () => {
    const panel = new GameResultPanelComponent();
    panel.outcome = outcome('WHITE_WIN', 'NEUTRAL', 'TIME_OUT');
    expect(panel.title).toBe('White wins');
    expect(panel.reason).toBe('Time expired');
  });

  it('uses the shared lobby action and disconnect reason for multiplayer results', () => {
    const panel = new GameResultPanelComponent();
    panel.mode = 'multiplayer';
    panel.outcome = outcome('WHITE_WIN', 'LOSS', 'DISCONNECT_TIMEOUT');
    expect(panel.playLabel).toBe('Back to lobby');
    expect(panel.reason).toBe('Opponent did not reconnect in time');
    panel.lang = 'pl';
    expect(panel.playLabel).toBe('Wróć do lobby');
    expect(panel.reason).toBe('Przeciwnik nie wrócił na czas');
  });
});
