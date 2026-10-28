import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgForOf, NgIf } from '@angular/common';
import type { MoveView } from '../game-state.service';

@Component({
  selector: 'app-move-history',
  standalone: true,
  imports: [NgForOf, NgIf],
  templateUrl: './move-history.component.html',
  styleUrl: './move-history.component.css'
})
export class MoveHistoryComponent {
  private static readonly MAX_REPLAY_ROWS = 80;
  @Input({ required: true }) moves: MoveView[] = [];
  @Input() interactive = false;
  @Input() positionIndex: number | null = null;
  @Input() navigationLabels = {
    group: 'Replay moves', first: 'First', previous: 'Previous', next: 'Next', last: 'Last'
  };
  @Output() positionIndexChange = new EventEmitter<number>();

  get currentPositionIndex() {
    return Math.max(0, Math.min(this.moves.length, this.positionIndex ?? this.moves.length));
  }

  get activeIndex() {
    return this.currentPositionIndex - 1;
  }

  setPosition(index: number) {
    if (!this.interactive) return;
    this.positionIndexChange.emit(Math.max(0, Math.min(this.moves.length, index)));
  }

  selectMove(moveIndex: number) {
    this.setPosition(moveIndex + 1);
  }

  get rows() {
    const rows: Array<{
      moveNumber: number;
      white: MoveView | null;
      black: MoveView | null;
      whiteIndex: number;
      blackIndex: number;
    }> = [];
    const totalRows = Math.ceil(this.moves.length / 2);
    let firstRow = 0;
    let lastRow = totalRows;
    if (this.interactive && totalRows > MoveHistoryComponent.MAX_REPLAY_ROWS) {
      const currentRow = Math.max(0, Math.floor(this.activeIndex / 2));
      firstRow = Math.max(0, Math.min(totalRows - MoveHistoryComponent.MAX_REPLAY_ROWS,
        currentRow - Math.floor(MoveHistoryComponent.MAX_REPLAY_ROWS / 2)));
      lastRow = firstRow + MoveHistoryComponent.MAX_REPLAY_ROWS;
    }
    for (let rowIndex = firstRow; rowIndex < lastRow; rowIndex += 1) {
      const i = rowIndex * 2;
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
