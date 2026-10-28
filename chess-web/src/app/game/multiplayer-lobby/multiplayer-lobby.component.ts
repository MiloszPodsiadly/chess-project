import { AsyncPipe, NgForOf, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MultiplayerService } from '../../multiplayer/multiplayer.service';
import type { PublicRoomDto, RoomParticipantDto, TimeControlType } from '../../multiplayer/models';

export interface LobbyCreateRoomRequest {
  timeControl: TimeControlType;
  name?: string;
  password: string | null;
  isPublic: boolean;
}

export interface LobbyJoinRoomRequest {
  roomCode: string;
  password: string | null;
}

type LobbyView = 'public' | 'create' | 'join' | 'manage';

@Component({
  selector: 'app-multiplayer-lobby',
  standalone: true,
  imports: [AsyncPipe, NgForOf, NgIf, FormsModule],
  templateUrl: './multiplayer-lobby.component.html',
  styleUrl: './multiplayer-lobby.component.css'
})
export class MultiplayerLobbyComponent {
  @Input({ required: true }) translations: Readonly<Record<string, string>> = {};
  @Input() username = '';
  @Input() connectionLabel = '';

  @Output() usernameChange = new EventEmitter<string>();
  @Output() retryRequested = new EventEmitter<void>();
  @Output() quickStart = new EventEmitter<TimeControlType>();
  @Output() createRequested = new EventEmitter<LobbyCreateRoomRequest>();
  @Output() joinRequested = new EventEmitter<LobbyJoinRoomRequest>();
  @Output() startRequested = new EventEmitter<string>();

  onlineView: LobbyView = 'public';
  onlineRoomName = '';
  onlineRoomPassword = '';
  onlineJoinPassword = '';
  onlinePublicRoom = true;
  onlineTimeControl: TimeControlType = 'RAPID';
  onlineRoomCode = '';

  constructor(public readonly multiplayer: MultiplayerService) {}

  t(key: string): string {
    return this.translations[key] ?? key;
  }

  setOnlineView(view: LobbyView) {
    this.onlineView = view;
    this.multiplayer.clearLastError();
  }

  onTabKeydown(event: KeyboardEvent) {
    const tabs: LobbyView[] = ['public', 'create', 'join', 'manage'];
    const index = tabs.indexOf(this.onlineView);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    this.setOnlineView(tabs[next]);
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  isOwnRoom(room: PublicRoomDto): boolean {
    const userId = this.multiplayer.sessionUserId$.value;
    return room.hostUserId != null && userId != null && room.hostUserId === userId;
  }

  isActiveRoom(roomCode: string): boolean {
    const activeRoom = this.multiplayer.activeRoomCode$.value;
    return !!activeRoom && activeRoom.toUpperCase() === roomCode.toUpperCase();
  }

  hasActiveRoom(): boolean {
    return !!this.multiplayer.activeRoomCode$.value;
  }

  isHostInRoom(): boolean {
    const userId = this.multiplayer.sessionUserId$.value;
    return userId != null && this.multiplayer.roomParticipants$.value.some(
      participant => (participant.role || '').toUpperCase() === 'HOST' && participant.userId === userId
    );
  }

  canKickParticipant(participant: RoomParticipantDto): boolean {
    const userId = this.multiplayer.sessionUserId$.value;
    const role = (participant.role || '').toUpperCase();
    return participant.userId != null
      && (role === 'PLAYER' || role === 'SPECTATOR')
      && userId != null
      && this.isHostInRoom()
      && participant.userId !== userId;
  }

  hasPendingPlayer(): boolean {
    return this.multiplayer.roomParticipants$.value.some(
      participant => (participant.role || '').toUpperCase() === 'PLAYER'
        && (participant.status || '').toUpperCase() !== 'LEFT'
    );
  }

  roomVisibilityLabel(): string {
    const roomCode = this.multiplayer.activeRoomCode$.value || this.multiplayer.roomCode$.value;
    if (!roomCode) return '';
    const room = this.multiplayer.publicRooms$.value.find(
      candidate => candidate.roomCode.toUpperCase() === roomCode.toUpperCase()
    );
    return this.t(room ? 'roomPublic' : 'roomPrivate');
  }

  startOnlineMatchmaking() {
    this.quickStart.emit(this.onlineTimeControl);
  }

  createOnlineRoom() {
    this.createRequested.emit({
      timeControl: this.onlineTimeControl,
      name: this.onlineRoomName.trim() || undefined,
      password: this.onlinePublicRoom ? null : (this.onlineRoomPassword.trim() || null),
      isPublic: this.onlinePublicRoom
    });
  }

  joinOnlineRoom() {
    if (!this.onlineRoomCode.trim()) return;
    this.joinRequested.emit({
      roomCode: this.onlineRoomCode.trim(),
      password: this.onlineJoinPassword.trim() || null
    });
  }

  startRoomGame(roomCode: string) {
    if (roomCode) this.startRequested.emit(roomCode);
  }

  onlineErrorMessage(code: string | null): string {
    if (!code) return '';
    switch (code) {
      case 'room_not_found': return 'Room not found.';
      case 'bad_password': return 'Wrong password.';
      case 'room_full': return 'Room is full.';
      case 'active_game': return 'You are already in an active game.';
      case 'room_join_failed': return 'Unable to join room.';
      case 'already_in_room': return 'You are already in another room.';
      case 'host_cannot_join': return 'You are the host of this room.';
      case 'room_create_failed':
      case 'roomCreateFailed': return 'Unable to create room.';
      case 'matchmaking_failed':
      case 'matchmakingFailed': return 'Matchmaking unavailable.';
      case 'already_queued': return this.t('alreadyQueued');
      case 'reconnect_failed': return this.t('reconnectFailed');
      case 'reconnect_ack_timeout': return this.t('reconnectAckTimeout');
      case 'invalid_reconnect_token':
      case 'invalid_room_reconnect_token': return this.t('recoveryFailed');
      case 'invalid_game_snapshot': return this.t('invalidGameSnapshot');
      case 'state_conflict': return this.t('stateConflict');
      case 'snapshot_recovery_failed': return this.t('snapshotRecoveryFailed');
      case 'room_invite_failed':
      case 'roomInviteFailed': return 'Unable to create invite.';
      case 'room_kick_failed':
      case 'roomKickFailed': return 'Unable to remove player.';
      case 'room_delete_failed':
      case 'roomDeleteFailed': return 'Unable to delete room.';
      case 'room_start_failed':
      case 'roomStartFailed': return 'Unable to start game.';
      case 'room_in_game': return 'Room already in game.';
      case 'roomKicked': return this.t('roomKicked');
      case 'room_closed_host_deleted': return this.t('roomClosedHostDeleted');
      case 'room_closed_host_left': return this.t('roomClosedHostLeft');
      case 'room_closed_host_disconnected': return this.t('roomClosedHostDisconnected');
      case 'room_closed_room_expired': return this.t('roomClosedRoomExpired');
      case 'room_closed_no_active_participants': return this.t('roomClosedNoParticipants');
      case 'roomClosed': return this.t('roomClosed');
      case 'roomDeleted': return this.t('roomDeleted');
      case 'draw_offer_limit': return 'Draw offer limit reached.';
      case 'room_spectate_failed':
      case 'roomSpectateFailed': return 'Unable to spectate room.';
      default: return this.t('onlineActionFailed');
    }
  }
}
