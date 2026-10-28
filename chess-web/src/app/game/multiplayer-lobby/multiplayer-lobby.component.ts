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

const ONLINE_ERROR_TRANSLATION_KEYS: Readonly<Record<string, string>> = {
  room_not_found: 'roomNotFoundError',
  bad_password: 'wrongRoomPasswordError',
  room_full: 'roomFullError',
  active_game: 'activeGameError',
  room_join_failed: 'roomJoinFailedError',
  already_in_room: 'alreadyInRoomError',
  host_cannot_join: 'hostCannotJoinError',
  room_create_failed: 'roomCreateFailedError',
  roomCreateFailed: 'roomCreateFailedError',
  matchmaking_failed: 'matchmakingUnavailableError',
  matchmakingFailed: 'matchmakingUnavailableError',
  already_queued: 'alreadyQueued',
  reconnect_failed: 'reconnectFailed',
  reconnect_ack_timeout: 'reconnectAckTimeout',
  invalid_reconnect_token: 'recoveryFailed',
  invalid_room_reconnect_token: 'recoveryFailed',
  invalid_game_snapshot: 'invalidGameSnapshot',
  state_conflict: 'stateConflict',
  snapshot_recovery_failed: 'snapshotRecoveryFailed',
  room_invite_failed: 'roomInviteFailedError',
  roomInviteFailed: 'roomInviteFailedError',
  room_kick_failed: 'roomKickFailedError',
  roomKickFailed: 'roomKickFailedError',
  room_delete_failed: 'roomDeleteFailedError',
  roomDeleteFailed: 'roomDeleteFailedError',
  room_start_failed: 'roomStartFailedError',
  roomStartFailed: 'roomStartFailedError',
  room_in_game: 'roomInGameError',
  roomKicked: 'roomKicked',
  room_closed_host_deleted: 'roomClosedHostDeleted',
  room_closed_host_left: 'roomClosedHostLeft',
  room_closed_host_disconnected: 'roomClosedHostDisconnected',
  room_closed_room_expired: 'roomClosedRoomExpired',
  room_closed_no_active_participants: 'roomClosedNoParticipants',
  roomClosed: 'roomClosed',
  roomDeleted: 'roomDeleted',
  draw_offer_limit: 'drawOfferLimitError',
  room_spectate_failed: 'roomSpectateFailedError',
  roomSpectateFailed: 'roomSpectateFailedError'
};

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
    return this.t(ONLINE_ERROR_TRANSLATION_KEYS[code] ?? 'onlineActionFailed');
  }
}
