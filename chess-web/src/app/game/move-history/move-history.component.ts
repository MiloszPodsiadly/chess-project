import { Component, Input } from '@angular/core';
import { NgForOf } from '@angular/common';
import type { MoveView } from '../game-state.service';

@Component({
  selector: 'app-move-history',
  standalone: true,
  imports: [NgForOf],
  templateUrl: './move-history.component.html',
  styleUrl: './move-history.component.css'
})
export class MoveHistoryComponent {
  @Input({ required: true }) moves: MoveView[] = [];

  get activeIndex() {
    return this.moves.length - 1;
  }

  get rows() {
    const rows: Array<{
      moveNumber: number;
      white: MoveView | null;
      black: MoveView | null;
      whiteIndex: number;
      blackIndex: number;
    }> = [];
    for (let i = 0; i < this.moves.length; i += 2) {
      rows.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: this.moves[i] ?? null,
        black: this.moves[i + 1] ?? null,
        whiteIndex: i,
        blackIndex: i + 1
      });
    }
    if (this.moves.length === 0) {
      rows.push({ moveNumber: 1, white: null, black: null, whiteIndex: 0, blackIndex: 1 });
    }
    return rows;
  }
}
