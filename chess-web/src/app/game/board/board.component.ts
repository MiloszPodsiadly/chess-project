import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgForOf, NgIf } from '@angular/common';

type PieceCode = string | null;

@Component({
  selector: 'app-board',
  standalone: true,
  imports: [NgForOf, NgIf],
  templateUrl: './board.component.html',
  styleUrl: './board.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BoardComponent {
  @Input({ required: true }) fen = '';
  @Input() selected: string | null = null;
  @Input() lastMove: { from: string; to: string } | null = null;
  @Input() orientation: 'white' | 'black' = 'white';
  @Output() squareClick = new EventEmitter<string>();

  @Input()
  set legalMoves(value: string[]) {
    this.legalMovesSet = new Set(value ?? []);
  }

  legalMovesSet = new Set<string>();
  displayRows: PieceCode[][] = [];
  squareGrid: string[][] = [];
  assetGrid: (string | null)[][] = [];

  ngOnChanges(): void {
    this.rebuildBoard();
  }

  boardFromFen(fen: string): PieceCode[][] {
    const rows = fen.split(' ')[0]?.split('/') ?? [];
    return rows.map((row) => {
      const result: PieceCode[] = [];
      for (const ch of row) {
        if (Number.isFinite(Number(ch))) {
          const empty = Number(ch);
          for (let i = 0; i < empty; i++) {
            result.push(null);
          }
        } else {
          result.push(ch);
        }
      }
      return result;
    });
  }

  pieceId(piece: PieceCode): string | null {
    if (!piece) {
      return null;
    }
    const isWhite = piece === piece.toUpperCase();
    const key = piece.toLowerCase();
    return `${isWhite ? 'w' : 'b'}${key}`;
  }

  pieceAsset(piece: PieceCode): string | null {
    if (!piece) {
      return null;
    }
    const isWhite = piece === piece.toUpperCase();
    const key = piece.toLowerCase();
    const colorFolder = isWhite ? 'white' : 'black';
    const map: Record<string, string> = {
      p: isWhite ? 'Chess_plt45.svg' : 'Chess_pdt45.svg',
      r: isWhite ? 'Chess_rlt45.svg' : 'Chess_rdt45.svg',
      n: isWhite ? 'Chess_nlt45.svg' : 'Chess_ndt45.svg',
      b: isWhite ? 'Chess_blt45.svg' : 'Chess_bdt45.svg',
      q: isWhite ? 'Chess_qlt45.svg' : 'Chess_qdt45.svg',
      k: isWhite ? 'Chess_klt45.svg' : 'Chess_kdt45.svg'
    };
    const file = map[key];
    if (!file) {
      return null;
    }
    return `assets/pieces/${colorFolder}/${file}`;
  }

  trackByIndex(index: number): number {
    return index;
  }

  private rebuildBoard(): void {
    const base = this.boardFromFen(this.fen);
    const oriented =
      this.orientation === 'white'
        ? base
        : base.slice().reverse().map((row) => row.slice().reverse());
    this.displayRows = oriented;

    const squares: string[][] = [];
    const assets: (string | null)[][] = [];
    for (let r = 0; r < 8; r += 1) {
      const rowSquares: string[] = [];
      const rowAssets: (string | null)[] = [];
      for (let f = 0; f < 8; f += 1) {
        const fileIndexOriented = this.orientation === 'white' ? f : 7 - f;
        const rank = this.orientation === 'white' ? 8 - r : 1 + r;
        const file = String.fromCharCode('a'.charCodeAt(0) + fileIndexOriented);
        rowSquares.push(`${file}${rank}`);
        rowAssets.push(this.pieceAsset(oriented[r]?.[f] ?? null));
      }
      squares.push(rowSquares);
      assets.push(rowAssets);
    }
    this.squareGrid = squares;
    this.assetGrid = assets;
  }
}
