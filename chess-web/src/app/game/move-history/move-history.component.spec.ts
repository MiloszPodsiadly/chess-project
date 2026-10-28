import { describe, expect, it, vi } from 'vitest';
import { MoveHistoryComponent } from './move-history.component';

describe('MoveHistoryComponent replay navigation', () => {
  it('keeps the final move selected by default and supports position navigation when enabled', () => {
    const history = new MoveHistoryComponent();
    history.moves = [
      { san: 'e4', from: 'e2', to: 'e4' },
      { san: 'e5', from: 'e7', to: 'e5' }
    ];
    expect(history.currentPositionIndex).toBe(2);
    expect(history.activeIndex).toBe(1);

    history.interactive = true;
    history.positionIndex = 0;
    expect(history.activeIndex).toBe(-1);
    const emit = vi.spyOn(history.positionIndexChange, 'emit');
    history.selectMove(0);
    history.setPosition(2);
    history.setPosition(99);

    expect(emit).toHaveBeenNthCalledWith(1, 1);
    expect(emit).toHaveBeenNthCalledWith(2, 2);
    expect(emit).toHaveBeenNthCalledWith(3, 2);
  });

  it('does not emit replay navigation for the ordinary read-only history', () => {
    const history = new MoveHistoryComponent();
    const emit = vi.spyOn(history.positionIndexChange, 'emit');

    history.selectMove(0);

    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps the rendered replay window bounded for long games', () => {
    const history = new MoveHistoryComponent();
    history.interactive = true;
    history.moves = Array.from({ length: 400 }, (_, index) => ({
      san: `m${index + 1}`, from: 'a2', to: 'a3'
    }));
    history.positionIndex = 400;

    expect(history.rows).toHaveLength(80);
    expect(history.rows.at(-1)?.moveNumber).toBe(200);

    history.positionIndex = 0;
    expect(history.rows[0]?.moveNumber).toBe(1);
    expect(history.rows).toHaveLength(80);
  });
});
