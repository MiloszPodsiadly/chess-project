import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AsyncPipe, NgForOf, NgIf } from '@angular/common';
import { MultiplayerService } from './multiplayer.service';
import { TimeControlType } from './models';

@Component({
  selector: 'app-multiplayer-page',
  standalone: true,
  imports: [FormsModule, AsyncPipe, NgIf, NgForOf],
  templateUrl: './multiplayer.page.html',
  styleUrl: './multiplayer.page.css'
})
export class MultiplayerPageComponent {
  username = '';
  reconnectToken = '';
  roomCode = '';
  roomName = '';
  roomPassword = '';
  joinPassword = '';
  isPublicRoom = true;
  timeControl: TimeControlType = 'RAPID';

  readonly timeControls: TimeControlType[] = ['BLITZ', 'RAPID', 'CLASSICAL', 'BULLET', 'UNTIMED'];

  constructor(public readonly multiplayer: MultiplayerService) {}

  connect() {
    this.multiplayer.connect(this.username, this.reconnectToken);
  }

  createRoom() {
    this.multiplayer.createRoom(this.timeControl, {
      name: this.roomName.trim() || undefined,
      password: this.isPublicRoom ? null : (this.roomPassword.trim() || null),
      isPublic: this.isPublicRoom
    });
  }

  joinRoom() {
    this.multiplayer.joinRoom(this.roomCode.trim(), this.joinPassword.trim() || null);
  }

  queue() {
    this.multiplayer.queueMatchmaking(this.timeControl);
  }

  sync() {
    this.multiplayer.requestSync();
  }

  errorMessage(code: string) {
    switch (code) {
      case 'invalid_room_or_password':
        return 'Room not found or wrong password.';
      case 'room_join_failed':
        return 'Unable to join room.';
      default:
        return `Last event: ${code}`;
    }
  }
}
