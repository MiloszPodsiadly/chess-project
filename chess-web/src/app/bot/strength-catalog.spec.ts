import { describe, expect, it } from 'vitest';
import { strengthCategory, strengthSelection } from './strength-catalog';
import { EngineConfigMapper } from './engine-config-mapper';

describe('strength catalog', () => {
  it('covers every boundary without a 2000 ceiling', () => {
    const cases: [number, string][] = [
      [200, 'ROOKIE'], [599, 'ROOKIE'], [600, 'BEGINNER'], [999, 'BEGINNER'],
      [1000, 'CASUAL'], [1319, 'CASUAL'], [1320, 'INTERMEDIATE'],
      [1321, 'INTERMEDIATE'], [1600, 'INTERMEDIATE'], [1800, 'ADVANCED'],
      [2000, 'ADVANCED'], [2200, 'ADVANCED'], [2400, 'EXPERT'],
      [2800, 'MASTER'], [3000, 'MASTER'], [3190, 'MASTER']
    ];
    for (const [level, category] of cases) {
      expect(strengthCategory(level)).toBe(category);
      expect(strengthSelection(level, 'server', false, 1000).target).toBe(level);
    }
    expect(strengthSelection(3190, 'server', true, 30000).category).toBe('MAXIMUM');
    expect(() => strengthCategory(3191)).toThrow();
  });

  it('marks browser settings as unverified and scales above 2000', () => {
    expect(strengthSelection(2800, 'browser', false, 1000).calibrated).toBe(false);
    expect(EngineConfigMapper.forElo(3190).depthCap).toBeGreaterThan(
      EngineConfigMapper.forElo(2000).depthCap);
  });
});
