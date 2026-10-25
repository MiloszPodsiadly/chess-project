import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Chess, Square } from 'chess.js';

export interface MoveView {
  san: string;
  from: string;
  to: string;
  promotion?: string;
}

@Injectable({ providedIn: 'root' })
export class GameStateService {
  private chess = new Chess();

  readonly fen$ = new BehaviorSubject<string>(this.chess.fen());
  readonly moves$ = new BehaviorSubject<MoveView[]>([]);
  readonly status$ = new BehaviorSubject<string>('Ready');
  readonly sideToMove$ = new BehaviorSubject<'w' | 'b'>(this.chess.turn());
  readonly selectedSquare$ = new BehaviorSubject<string | null>(null);
  readonly legalMoves$ = new BehaviorSubject<string[]>([]);
  readonly lastMove$ = new BehaviorSubject<MoveView | null>(null);

  reset() {
    this.chess.reset();
    this.fen$.next(this.chess.fen());
    this.moves$.next([]);
    this.status$.next('Ready');
    this.sideToMove$.next(this.chess.turn());
    this.selectedSquare$.next(null);
    this.legalMoves$.next([]);
    this.lastMove$.next(null);
  }

  loadExternalState(fen: string, moves: MoveView[], sideToMove: 'w' | 'b') {
    this.chess.load(fen);
    this.fen$.next(fen);
    this.moves$.next(moves);
    this.status$.next(this.computeStatus());
    this.sideToMove$.next(sideToMove);
    this.selectedSquare$.next(null);
    this.legalMoves$.next([]);
    this.lastMove$.next(moves.length > 0 ? moves[moves.length - 1] : null);
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
    const move = this.chess.move({
      from: from as Square,
      to: to as Square,
      promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined
    });
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
    return true;
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
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
