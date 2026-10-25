export type StrengthCategory = 'ROOKIE' | 'BEGINNER' | 'CASUAL' | 'INTERMEDIATE'
  | 'ADVANCED' | 'EXPERT' | 'MASTER' | 'MAXIMUM';

export interface StrengthSelection {
  category: StrengthCategory;
  mode: 'BEGINNER' | 'TRAINING' | 'FULL_STRENGTH';
  target: number | null;
  supportedMin: number | null;
  supportedMax: number | null;
  execution: 'browser' | 'server';
  budgetMs: number;
  calibrated: boolean;
}

const ranges: [StrengthCategory, number, number][] = [
  ['ROOKIE', 200, 599], ['BEGINNER', 600, 999], ['CASUAL', 1000, 1319],
  ['INTERMEDIATE', 1320, 1799], ['ADVANCED', 1800, 2299],
  ['EXPERT', 2300, 2799], ['MASTER', 2800, 3190]
];

export function strengthCategory(value: number): StrengthCategory {
  const match = ranges.find(([, min, max]) => value >= min && value <= max);
  if (!match) throw new RangeError('Strength target must be 200–3190');
  return match[0];
}

export function strengthSelection(target: number, execution: 'browser' | 'server',
                                  maximum: boolean, budgetMs: number): StrengthSelection {
  if (maximum) return { category: 'MAXIMUM', mode: 'FULL_STRENGTH', target: null,
    supportedMin: null, supportedMax: null, execution, budgetMs, calibrated: false };
  const category = strengthCategory(target);
  return { category, mode: target >= 1320 ? 'TRAINING' : 'BEGINNER', target,
    supportedMin: 200, supportedMax: 3190, execution, budgetMs,
    calibrated: false };
}
