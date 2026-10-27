import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgIf } from '@angular/common';
import { EndReason, GameOutcome } from '../game-outcome';

const reasons: Record<EndReason, { en: string; pl: string }> = {
  CHECKMATE: { en: 'Checkmate', pl: 'Mat' },
  STALEMATE: { en: 'Stalemate', pl: 'Pat' },
  THREEFOLD_REPETITION: { en: 'Threefold repetition', pl: 'Trzykrotne powtórzenie' },
  FIFTY_MOVE_RULE: { en: 'Fifty-move rule', pl: 'Reguła 50 posunięć' },
  INSUFFICIENT_MATERIAL: { en: 'Insufficient material', pl: 'Niewystarczający materiał' },
  RESIGNATION: { en: 'Resignation', pl: 'Poddanie partii' },
  TIME_OUT: { en: 'Time expired', pl: 'Koniec czasu' },
  DISCONNECT_TIMEOUT: { en: 'Opponent did not reconnect in time', pl: 'Przeciwnik nie wrócił na czas' },
  AGREED_DRAW: { en: 'Draw by agreement', pl: 'Remis za zgodą' },
  UNKNOWN: { en: 'Game completed', pl: 'Partia zakończona' }
};

@Component({
  selector: 'app-game-result-panel',
  standalone: true,
  imports: [NgIf],
  templateUrl: './game-result-panel.component.html',
  styleUrl: './game-result-panel.component.css'
})
export class GameResultPanelComponent {
  @Input({ required: true }) outcome!: GameOutcome;
  @Input() lang: 'en' | 'pl' = 'en';
  @Input() opponent = 'Stockfish 19';
  @Input() dismissed = false;
  @Input() mode: 'bot' | 'multiplayer' = 'bot';
  @Input() showMeta = true;
  @Input() headingId: string | null = null;
  @Output() playAgain = new EventEmitter<void>();
  @Output() review = new EventEmitter<void>();
  @Output() changeSetup = new EventEmitter<void>();

  get title(): string {
    if (this.outcome.perspective === 'WIN') return this.lang === 'pl' ? 'Zwycięstwo!' : 'Victory!';
    if (this.outcome.perspective === 'LOSS') return this.lang === 'pl' ? 'Porażka' : 'Defeat';
    if (this.outcome.perspective === 'DRAW') return this.lang === 'pl' ? 'Remis' : 'Draw';
    return this.outcome.result === 'WHITE_WIN'
      ? this.lang === 'pl' ? 'Wygrywają białe' : 'White wins'
      : this.lang === 'pl' ? 'Wygrywają czarne' : 'Black wins';
  }

  get reason(): string { return reasons[this.outcome.endReason][this.lang]; }
  get notation(): string {
    return this.outcome.result === 'WHITE_WIN' ? '1–0'
      : this.outcome.result === 'BLACK_WIN' ? '0–1' : '½–½';
  }
  get moveLabel(): string { return this.lang === 'pl' ? 'Ruchy' : 'Moves'; }
  get playLabel(): string {
    if (this.mode === 'multiplayer') return this.lang === 'pl' ? 'Wróć do lobby' : 'Back to lobby';
    return this.lang === 'pl' ? 'Zagraj ponownie' : 'Play Again';
  }
  get reviewLabel(): string { return this.lang === 'pl' ? 'Zobacz partię' : 'Review Game'; }
  get changeLabel(): string { return this.lang === 'pl' ? 'Zmień poziom' : 'Change Difficulty'; }
}
