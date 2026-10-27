import { describe, expect, it } from 'vitest';
import { ChessArenaAnimationComponent } from './chess-arena-animation.component';

describe('ChessArenaAnimationComponent', () => {
  it('provides translated status text for each presentation state', () => {
    const component = Object.create(ChessArenaAnimationComponent.prototype) as ChessArenaAnimationComponent;
    component.lang = 'en';
    component.state = 'WAITING_FOR_OPPONENT';
    expect(component.statusLabel).toBe('Waiting for an opponent');
    component.state = 'MATCH_FOUND';
    expect(component.statusLabel).toBe('Opponent found');
    component.lang = 'pl';
    component.state = 'RECONNECTING';
    expect(component.statusLabel).toBe('Ponowne łączenie z serwerem');
  });
});
