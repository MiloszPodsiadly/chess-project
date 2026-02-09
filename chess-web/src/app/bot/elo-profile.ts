export type MoveSelection = 'RANDOM_LEGAL' | 'RANDOM_TOP_N' | 'TOP_N' | 'BEST_OR_TOP2' | 'BEST';

export interface EloProfile {
  elo: number;
  minTimeMs: number;
  maxTimeMs: number;
  depthCap: number;
  topMoves: number;
  moveSelection: MoveSelection;
  blunderProb: number;
}
