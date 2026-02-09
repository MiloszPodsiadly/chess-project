import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-game-controls',
  standalone: true,
  imports: [NgIf],
  templateUrl: './game-controls.component.html',
  styleUrl: './game-controls.component.css'
})
export class GameControlsComponent {
  @Input() turn: string | null = null;
  @Input() status: string | null = null;
  @Input() multiplayerGameId: string | null = null;
  @Output() reset = new EventEmitter<void>();
}
