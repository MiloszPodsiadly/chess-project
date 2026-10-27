import { describe, expect, it } from 'vitest';
import { EngineAnalysisService } from './engine-analysis.service';

describe('EngineAnalysisService', () => {
  it('converts a black perspective score for white display and clears external state', () => {
    const analysis = new EngineAnalysisService();
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    analysis.applyExternalAnalysis({
      bestMove: { from: 'e7', to: 'e5', playerColor: 'BLACK' },
      principalVariation: [],
      evaluation: { type: 'CP', value: 80, side: 'BLACK' },
      depth: 12,
      nodes: 100,
      timeMillis: 100,
      topLines: []
    }, fen);

    expect(analysis.evaluation$.value).toBe('-0.80');
    expect(analysis.completedEvaluation$.value).toEqual({ fen, value: '-0.80' });
    expect(analysis.external$.value).toBe(true);
    expect(analysis.depth$.value).toBe(12);
    expect(analysis.timeMillis$.value).toBe(100);
    expect(analysis.nps$.value).toBe(1000);

    analysis.useLocalAnalysis();
    expect(analysis.external$.value).toBe(false);
    expect(analysis.evaluation$.value).toBe('—');
    expect(analysis.bestMove$.value).toBeNull();
    expect(analysis.timeMillis$.value).toBeNull();
  });
});
