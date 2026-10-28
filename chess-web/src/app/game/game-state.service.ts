import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Chess, Square } from 'chess.js';
import { GameColor, GameOutcome, localOutcome } from './game-outcome';

export interface MoveView {
  san: string;
  from: string;
  to: string;
  promotion?: string;
}

export interface ExternalMove {
  from: string;
  to: string;
  promotion?: string | null;
}

@Injectable({ providedIn: 'root' })
export class GameStateService {
  private static nextSession = 0;
  private chess = new Chess();
  private sessionId = `local-${++GameStateService.nextSession}`;

  readonly fen$ = new BehaviorSubject<string>(this.chess.fen());
  readonly moves$ = new BehaviorSubject<MoveView[]>([]);
  readonly status$ = new BehaviorSubject<string>('Ready');
  readonly sideToMove$ = new BehaviorSubject<'w' | 'b'>(this.chess.turn());
  readonly selectedSquare$ = new BehaviorSubject<string | null>(null);
  readonly legalMoves$ = new BehaviorSubject<string[]>([]);
  readonly lastMove$ = new BehaviorSubject<MoveView | null>(null);
  readonly positionStatus$ = new BehaviorSubject<'NORMAL' | 'CHECK' | 'CHECKMATE'>('NORMAL');
  readonly checkedKingSquare$ = new BehaviorSubject<string | null>(null);

  reset() {
    this.chess.reset();
    this.sessionId = `local-${++GameStateService.nextSession}`;
    this.fen$.next(this.chess.fen());
    this.moves$.next([]);
    this.status$.next('Ready');
    this.sideToMove$.next(this.chess.turn());
    this.selectedSquare$.next(null);
    this.legalMoves$.next([]);
    this.lastMove$.next(null);
    this.updatePositionAnnotations();
  }

  loadExternalState(fen: string, moves: ExternalMove[], sideToMove: 'w' | 'b'): MoveView[] {
    const replay = new Chess();
    let doublePawnPushTarget: string | null = null;
    for (const move of moves) {
      try {
        const movingPiece = replay.get(move.from as Square);
        const rankDistance = Number(move.to[1]) - Number(move.from[1]);
        doublePawnPushTarget = movingPiece?.type === 'p' && Math.abs(rankDistance) === 2
          ? `${move.from[0]}${(Number(move.from[1]) + Number(move.to[1])) / 2}` : null;
        replay.move({ from: move.from as Square, to: move.to as Square,
          promotion: move.promotion as 'q' | 'r' | 'b' | 'n' | undefined });
      } catch {
        throw new Error(`Invalid game history at move ${replay.history().length + 1}`);
      }
    }
    const expected = fen.split(' ');
    const actual = replay.fen().split(' ');
    const forcedEnPassant = replay.fen({ forceEnpassantSquare: true }).split(' ');
    if (actual.length !== 6 || forcedEnPassant.length !== 6 || expected.length !== 6 || sideToMove !== replay.turn()
        || [0, 1, 2, 4, 5].some(index => actual[index] !== expected[index])
        || ![actual[3], forcedEnPassant[3], doublePawnPushTarget].includes(expected[3])) {
      throw new Error('Game history does not match the server position');
    }
    this.chess = replay;
    const validatedMoves = replay.history({ verbose: true }).map(move => ({
      san: move.san, from: move.from, to: move.to, promotion: move.promotion
    }));
    this.fen$.next(replay.fen());
    this.moves$.next(validatedMoves);
    this.status$.next(this.computeStatus());
    this.sideToMove$.next(sideToMove);
    this.selectedSquare$.next(null);
    this.legalMoves$.next([]);
    this.lastMove$.next(validatedMoves.length > 0 ? validatedMoves[validatedMoves.length - 1] : null);
    this.updatePositionAnnotations();
    return validatedMoves;
  }

  selectSquare(square: string) {
    const current = this.selectedSquare$.value;
    if (current === square) {
      this.clearSelection();
      return;
    }
    this.selectedSquare$.next(square);
    const moves = this.chess.moves({ square: square as Square, verbose: true });
    this.legalMoves$.next(moves.map((m) => m.to));
  }

  clearSelection() {
    this.selectedSquare$.next(null);
    this.legalMoves$.next([]);
  }

  attemptMove(from: string, to: string, promotion?: string) {
    if (this.chess.isGameOver()) return false;
    let move;
    try {
      move = this.chess.move({
        from: from as Square, to: to as Square,
        promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined
      });
    } catch { return false; }
    if (!move) {
      return false;
    }
    this.fen$.next(this.chess.fen());
    this.sideToMove$.next(this.chess.turn());
    this.selectedSquare$.next(null);
    this.legalMoves$.next([]);
    this.moves$.next(
      this.chess.history({ verbose: true }).map((m) => ({
        san: m.san,
        from: m.from,
        to: m.to,
        promotion: m.promotion
      }))
    );
    const history = this.moves$.value;
    this.lastMove$.next(history.length > 0 ? history[history.length - 1] : null);
    this.status$.next(this.computeStatus());
    this.updatePositionAnnotations();
    return true;
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  outcome(playerColor: GameColor, resigned = false): GameOutcome | null {
    return localOutcome(this.chess, playerColor, this.sessionId, resigned);
  }

  inCheck(): boolean { return this.chess.inCheck(); }

  private updatePositionAnnotations() {
    const status = this.chess.isCheckmate() ? 'CHECKMATE'
      : this.chess.inCheck() ? 'CHECK' : 'NORMAL';
    if (this.positionStatus$.value !== status) this.positionStatus$.next(status);
    const king = status === 'NORMAL' ? null : this.chess.board().flat()
      .find(piece => piece?.type === 'k' && piece.color === this.chess.turn())?.square ?? null;
    if (this.checkedKingSquare$.value !== king) this.checkedKingSquare$.next(king);
  }

  private computeStatus() {
    if (this.chess.isCheckmate()) {
      return 'Checkmate';
    }
    if (this.chess.isStalemate()) {
      return 'Stalemate';
    }
    if (this.chess.isThreefoldRepetition()) {
      return 'Draw by repetition';
    }
    if (this.chess.isInsufficientMaterial()) {
      return 'Draw by insufficient material';
    }
    if (this.chess.isDraw()) {
      return 'Draw';
    }
    if (this.chess.inCheck()) {
      return 'Check';
    }
    return 'In progress';
  }
}
