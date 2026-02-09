import type { EloProfile, MoveSelection } from './elo-profile';
import { Chess } from 'chess.js';

export interface CandidateMove {
  move: string;
  score: number;
}

export class BotMoveStrategy {
  static chooseMove(candidates: CandidateMove[], profile: EloProfile, fen: string | null): CandidateMove | null {
    if (!candidates.length) {
      return null;
    }
    const filtered = fen ? this.filterRepetitions(candidates, fen) : candidates;
    const ordered = [...filtered].sort((a, b) => b.score - a.score);
    const selection: MoveSelection = profile.moveSelection;
    const topN = Math.max(1, profile.topMoves);
    const top = ordered.slice(0, topN);
    const blunder = Math.random() < profile.blunderProb;

    if (selection === 'RANDOM_TOP_N') {
      if (blunder && ordered.length > top.length) {
        return ordered[ordered.length - 1];
      }
      return top[Math.floor(Math.random() * top.length)];
    }
    if (selection === 'TOP_N') {
      if (blunder && top.length > 1) {
        return top[Math.floor(Math.random() * top.length)];
      }
      return top[0];
    }
    if (selection === 'BEST_OR_TOP2') {
      if (top.length > 1 && Math.random() < 0.2) {
        return top[1];
      }
      return top[0];
    }
    if (selection === 'BEST') {
      return top[0];
    }
    return top[Math.floor(Math.random() * top.length)];
  }

  private static filterRepetitions(candidates: CandidateMove[], fen: string): CandidateMove[] {
    try {
      const chess = new Chess(fen);
      return candidates.filter((candidate) => {
        const move = candidate.move;
        if (move.length < 4) {
          return true;
        }
        const from = move.slice(0, 2);
        const to = move.slice(2, 4);
        const promotion = move.length > 4 ? move[4] : undefined;
        const copy = new Chess(chess.fen());
        const result = copy.move({ from, to, promotion: promotion as any });
        if (!result) {
          return false;
        }
        return !copy.isThreefoldRepetition();
      });
    } catch {
      return candidates;
    }
  }
}
