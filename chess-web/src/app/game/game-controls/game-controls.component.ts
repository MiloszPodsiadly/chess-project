import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-game-controls',
  standalone: true,
  templateUrl: './game-controls.component.html',
  styleUrl: './game-controls.component.css'
})
export class GameControlsComponent {
  @Input() turn: string | null = null;
  @Input() status: string | null = null;
  @Output() reset = new EventEmitter<void>();
}
