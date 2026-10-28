import { Chess, Square } from 'chess.js';
import type { ExternalMove, MoveView } from './game-state.service';

export type ReplayPositionStatus = 'NORMAL' | 'CHECK' | 'CHECKMATE';

export interface ReplayPosition {
  fen: string;
  lastMove: MoveView | null;
  status: ReplayPositionStatus;
  checkedKingSquare: string | null;
}

/** A validated, read-only cursor over a completed server game. */
export class MultiplayerReplayState {
  readonly moves: MoveView[];
  readonly positions: ReplayPosition[];
  private index = 0;

  constructor(authoritativeFen: string, externalMoves: ExternalMove[], sideToMove: 'w' | 'b',
    startingFen = new Chess().fen()) {
    const replay = new Chess(startingFen);
    const positions = [this.snapshot(replay, null)];
    const moves: MoveView[] = [];
    let doublePawnPushTarget: string | null = null;

    for (const externalMove of externalMoves) {
      let applied;
      try {
        const movingPiece = replay.get(externalMove.from as Square);
        const rankDistance = Number(externalMove.to[1]) - Number(externalMove.from[1]);
        doublePawnPushTarget = movingPiece?.type === 'p' && Math.abs(rankDistance) === 2
          ? `${externalMove.from[0]}${(Number(externalMove.from[1]) + Number(externalMove.to[1])) / 2}` : null;
        applied = replay.move({
          from: externalMove.from as Square,
          to: externalMove.to as Square,
          promotion: externalMove.promotion as 'q' | 'r' | 'b' | 'n' | undefined
        });
      } catch {
        throw new Error(`Invalid game history at move ${moves.length + 1}`);
      }
      if (!applied) throw new Error(`Invalid game history at move ${moves.length + 1}`);

      const move = {
        san: applied.san,
        from: applied.from,
        to: applied.to,
        promotion: applied.promotion
      };
      moves.push(move);
      positions.push(this.snapshot(replay, move));
    }

    if (!this.matchesAuthoritativePosition(replay, authoritativeFen, sideToMove, doublePawnPushTarget)) {
      throw new Error('Game history does not match the server position');
    }
    if (positions.length > 0) {
      positions[positions.length - 1] = { ...positions[positions.length - 1], fen: authoritativeFen };
    }

    this.moves = moves;
    this.positions = positions;
    this.index = moves.length;
  }

  get positionIndex(): number {
    return this.index;
  }

  get activeMoveIndex(): number {
    return this.index - 1;
  }

  get currentPosition(): ReplayPosition {
    return this.positions[this.index];
  }

  first() { this.seek(0); }
  previous() { this.seek(this.index - 1); }
  next() { this.seek(this.index + 1); }
  last() { this.seek(this.moves.length); }

  seek(positionIndex: number) {
    if (!Number.isFinite(positionIndex)) return;
    this.index = Math.max(0, Math.min(this.moves.length, Math.trunc(positionIndex)));
  }

  private snapshot(chess: Chess, lastMove: MoveView | null): ReplayPosition {
    const status: ReplayPositionStatus = chess.isCheckmate() ? 'CHECKMATE'
      : chess.inCheck() ? 'CHECK' : 'NORMAL';
    const checkedKingSquare = status === 'NORMAL' ? null : chess.board().flat()
      .find(piece => piece?.type === 'k' && piece.color === chess.turn())?.square ?? null;
    return { fen: chess.fen(), lastMove, status, checkedKingSquare };
  }

  private matchesAuthoritativePosition(chess: Chess, fen: string, sideToMove: 'w' | 'b',
    doublePawnPushTarget: string | null): boolean {
    const actual = chess.fen().split(' ');
    const forcedEnPassant = chess.fen({ forceEnpassantSquare: true }).split(' ');
    const expected = fen.split(' ');
    return actual.length === 6 && forcedEnPassant.length === 6 && expected.length === 6 && sideToMove === chess.turn()
      && [0, 1, 2, 4, 5].every(index => actual[index] === expected[index])
      && [actual[3], forcedEnPassant[3], doublePawnPushTarget].includes(expected[3]);
  }
}
