import type { EloProfile } from './elo-profile';

export class EngineConfigMapper {
  static forElo(elo: number): EloProfile {
    if (!Number.isInteger(elo) || elo < 200 || elo > 3190) {
      throw new RangeError('Local strength setting must be 200–3190');
    }
    if (elo <= 200) {
      return { elo: 200, minTimeMs: 20, maxTimeMs: 40, depthCap: 1, topMoves: 999, moveSelection: 'RANDOM_LEGAL', blunderProb: 0.45 };
    }
    if (elo <= 400) {
      return { elo: 400, minTimeMs: 50, maxTimeMs: 50, depthCap: 2, topMoves: 8, moveSelection: 'RANDOM_TOP_N', blunderProb: 0.3 };
    }
    if (elo <= 600) {
      return { elo: 600, minTimeMs: 80, maxTimeMs: 80, depthCap: 3, topMoves: 6, moveSelection: 'RANDOM_TOP_N', blunderProb: 0.22 };
    }
    if (elo <= 800) {
      return { elo: 800, minTimeMs: 120, maxTimeMs: 120, depthCap: 4, topMoves: 5, moveSelection: 'RANDOM_TOP_N', blunderProb: 0.16 };
    }
    if (elo <= 1000) {
      return { elo: 1000, minTimeMs: 180, maxTimeMs: 180, depthCap: 6, topMoves: 4, moveSelection: 'RANDOM_TOP_N', blunderProb: 0.1 };
    }
    if (elo <= 1200) {
      return { elo: 1200, minTimeMs: 250, maxTimeMs: 250, depthCap: 8, topMoves: 3, moveSelection: 'RANDOM_TOP_N', blunderProb: 0.06 };
    }
    if (elo <= 1400) {
      return { elo: 1400, minTimeMs: 350, maxTimeMs: 350, depthCap: 10, topMoves: 2, moveSelection: 'TOP_N', blunderProb: 0.03 };
    }
    if (elo <= 1600) {
      return { elo: 1600, minTimeMs: 500, maxTimeMs: 500, depthCap: 12, topMoves: 2, moveSelection: 'BEST_OR_TOP2', blunderProb: 0.02 };
    }
    if (elo <= 1800) {
      return { elo: 1800, minTimeMs: 800, maxTimeMs: 800, depthCap: 15, topMoves: 1, moveSelection: 'BEST', blunderProb: 0.01 };
    }
    const fraction = (elo - 1800) / (3190 - 1800);
    const movetime = Math.round(800 + fraction * 2200);
    return { elo, minTimeMs: movetime, maxTimeMs: movetime,
      depthCap: Math.round(15 + fraction * 9), topMoves: 1,
      moveSelection: 'BEST', blunderProb: 0 };
  }

  static pickTime(profile: EloProfile) {
    if (profile.minTimeMs >= profile.maxTimeMs) {
      return profile.minTimeMs;
    }
    const range = profile.maxTimeMs - profile.minTimeMs;
    return profile.minTimeMs + Math.floor(Math.random() * (range + 1));
  }
}
