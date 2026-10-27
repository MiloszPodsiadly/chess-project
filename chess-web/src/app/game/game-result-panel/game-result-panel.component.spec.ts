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
    expect(panel.reason).toBe('Checkmate');
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

  it('maps each multiplayer terminal reason to its result label', () => {
    const panel = new GameResultPanelComponent();
    panel.mode = 'multiplayer';
    const cases: Array<[GameOutcome['result'], GameOutcome['perspective'], GameOutcome['endReason'], string]> = [
      ['WHITE_WIN', 'WIN', 'CHECKMATE', 'Checkmate'],
      ['DRAW', 'DRAW', 'STALEMATE', 'Stalemate'],
      ['BLACK_WIN', 'LOSS', 'RESIGNATION', 'Resignation'],
      ['WHITE_WIN', 'WIN', 'TIME_OUT', 'Time expired'],
      ['DRAW', 'DRAW', 'AGREED_DRAW', 'Draw by agreement'],
      ['BLACK_WIN', 'LOSS', 'DISCONNECT_TIMEOUT', 'Opponent did not reconnect in time']
    ];

    for (const [result, perspective, endReason, label] of cases) {
      panel.outcome = outcome(result, perspective, endReason);
      expect(panel.reason).toBe(label);
      expect(panel.playLabel).toBe('Back to lobby');
    }
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
