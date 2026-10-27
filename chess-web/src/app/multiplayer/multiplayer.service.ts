import { Injectable } from '@angular/core';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { BehaviorSubject } from 'rxjs';
import { Chess, Square } from 'chess.js';
import {
  EngineMoveResponseDto,
  GameEndedEvent,
  GameStartedEvent,
  GameStateSyncDto,
  GameStateSyncEvent,
  MoveAcceptedEvent,
  MoveRejectedEvent,
  PublicRoomDto,
  RoomInviteDto,
  RoomHistoryDto,
  RoomMessageDto,
  RoomParticipantsDto,
  RoomParticipantDto,
  HelloAck,
  MultiplayerConnectionState,
  MatchmakingQueueState,
  TimeControlType,
  WsEvent
} from './models';

@Injectable({ providedIn: 'root' })
export class MultiplayerService {
  private static readonly MAX_RECONNECT_ATTEMPTS = 8;
  private client: Client | null = null;
  private currentGameId: string | null = null;
  private readonly ignoredGameIds = new Set<string>();
  private roomSubscription: StompSubscription | null = null;
  private roomSubscriptionCode: string | null = null;
  private gameSubscription: StompSubscription | null = null;
  private gameSubscriptionId: string | null = null;
  private queueSubscription: StompSubscription | null = null;
  private lobbySubscription: StompSubscription | null = null;
  private connectionUsername: string | null = null;
  private currentReconnectToken: string | null = null;
  private reconnectAttempts = 0;
  private matchFoundTimer: ReturnType<typeof setTimeout> | null = null;
  private everConnected = false;
  private awaitingRecoverySnapshot = false;
  private manualDisconnect = false;

  readonly connected$ = new BehaviorSubject<boolean>(false);
  readonly connectionState$ = new BehaviorSubject<MultiplayerConnectionState>('DISCONNECTED');
  readonly opponentDisconnected$ = new BehaviorSubject<boolean>(false);
  readonly queueState$ = new BehaviorSubject<MatchmakingQueueState>('IDLE');
  readonly matchFound$ = new BehaviorSubject<boolean>(false);
  readonly roomCode$ = new BehaviorSubject<string | null>(null);
  readonly gameState$ = new BehaviorSubject<GameStateSyncDto | null>(null);
  readonly lastError$ = new BehaviorSubject<string | null>(null);
  readonly reconnectToken$ = new BehaviorSubject<string | null>(null);
  readonly timeControl$ = new BehaviorSubject<TimeControlType | null>(null);
  readonly yourColor$ = new BehaviorSubject<'WHITE' | 'BLACK' | null>(null);
  readonly publicRooms$ = new BehaviorSubject<PublicRoomDto[]>([]);
  readonly drawOffer$ = new BehaviorSubject<boolean>(false);
  readonly activeRoomCode$ = new BehaviorSubject<string | null>(null);
  readonly roomMessages$ = new BehaviorSubject<RoomMessageDto[]>([]);
  readonly roomInvite$ = new BehaviorSubject<RoomInviteDto | null>(null);
  readonly ready$ = new BehaviorSubject<boolean>(false);
  readonly sessionUsername$ = new BehaviorSubject<string | null>(null);
  readonly sessionUserId$ = new BehaviorSubject<number | null>(null);
  readonly roomParticipants$ = new BehaviorSubject<RoomParticipantDto[]>([]);

  connect(username?: string, reconnectToken?: string) {
    if (username !== undefined) {
      this.connectionUsername = username ?? null;
    }
    if (reconnectToken) {
      this.currentReconnectToken = reconnectToken;
    }
    if (this.client && this.client.active) {
      return;
    }
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.awaitingRecoverySnapshot = !!this.currentReconnectToken;
    this.connectionState$.next(this.everConnected ? 'RECONNECTING' : 'CONNECTING');
    const wsUrl = this.resolveWsUrl();
    this.client = new Client({
      webSocketFactory: () => new SockJS(wsUrl),
      reconnectDelay: 2000,
      onConnect: () => {
        this.everConnected = true;
        this.reconnectAttempts = 0;
        this.connected$.next(true);
        this.ready$.next(false);
        this.connectionState$.next('AUTHENTICATING');
        this.subscribeQueue();
        this.subscribeLobby();
        this.send('hello/auth', {
          username: this.connectionUsername,
          reconnectToken: this.currentReconnectToken
        });
      },
      onStompError: () => {
        this.lastError$.next('stomp_error');
      },
      onWebSocketClose: () => {
        this.connected$.next(false);
        this.ready$.next(false);
        this.sessionUsername$.next(null);
        this.sessionUserId$.next(null);
        this.queueState$.next('IDLE');
        this.resetSubscriptionHandles();
        this.awaitingRecoverySnapshot = !!this.currentReconnectToken
          || this.gameState$.value?.result === 'ONGOING';
        if (this.manualDisconnect) {
          this.connectionState$.next('DISCONNECTED');
          return;
        }
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= MultiplayerService.MAX_RECONNECT_ATTEMPTS) {
          this.connectionState$.next('ERROR');
          this.lastError$.next('reconnect_failed');
          const client = this.client;
          if (client) void client.deactivate();
          return;
        }
        this.connectionState$.next(this.everConnected ? 'RECONNECTING' : 'CONNECTING');
      }
    });
    this.client.activate();
  }

  createRoom(timeControlType: TimeControlType, options?: { name?: string; password?: string | null; isPublic?: boolean }) {
    this.send('createRoom', {
      timeControlType,
      name: options?.name ?? null,
      password: options?.password ?? null,
      isPublic: options?.isPublic ?? true
    });
  }

  joinRoom(roomCode: string, password?: string | null, inviteToken?: string | null) {
    this.send('joinRoom', { roomCode, password: password ?? null, inviteToken: inviteToken ?? null });
    if (roomCode) {
      this.setActiveRoom(roomCode);
    }
  }

  queueMatchmaking(timeControlType: TimeControlType) {
    this.send('queueMatchmaking', { timeControlType });
  }

  cancelMatchmaking() {
    this.send('cancelMatchmaking', {});
  }

  makeMove(gameId: string, move: { from: string; to: string; promotion?: string | null }) {
    if (this.connectionState$.value !== 'READY') {
      return;
    }
    const current = this.gameState$.value;
    this.send('makeMove', {
      gameId,
      move,
      expectedVersion: current?.gameId === gameId ? current.version ?? null : null
    });
  }

  resign(gameId: string) {
    this.send('resign', { gameId });
  }

  offerDraw(gameId: string) {
    const current = this.gameState$.value;
    this.send('offerDraw', {
      gameId,
      fen: current?.fen ?? null,
      sideToMove: current?.sideToMove ?? null,
      whiteTimeLeftMs: current?.whiteTimeLeftMs ?? null,
      blackTimeLeftMs: current?.blackTimeLeftMs ?? null
    });
  }

  acceptDraw(gameId: string) {
    const current = this.gameState$.value;
    this.send('acceptDraw', {
      gameId,
      fen: current?.fen ?? null,
      sideToMove: current?.sideToMove ?? null,
      whiteTimeLeftMs: current?.whiteTimeLeftMs ?? null,
      blackTimeLeftMs: current?.blackTimeLeftMs ?? null
    });
  }

  declineDraw(gameId: string) {
    this.send('declineDraw', { gameId });
    this.drawOffer$.next(false);
  }

  requestSync(gameId?: string) {
    this.send('requestSync', { gameId: gameId ?? null });
  }

  listRooms() {
    this.send('listRooms', {});
  }

  createInvite(roomCode: string, maxUses = 1, expiresInMinutes = 60) {
    this.send('createInvite', { roomCode, maxUses, expiresInMinutes });
  }

  spectateRoom(roomCode: string) {
    this.send('spectateRoom', { roomCode });
    this.setActiveRoom(roomCode);
  }

  sendRoomMessage(roomCode: string, message: string) {
    this.send('roomMessage', { roomCode, message });
  }

  roomHistory(roomCode: string) {
    this.send('roomHistory', { roomCode });
  }

  roomParticipants(roomCode: string) {
    this.send('roomParticipants', { roomCode });
  }

  kickPlayer(roomCode: string, userId: number) {
    this.send('kickPlayer', { roomCode, userId });
  }

  deleteRoom(roomCode: string) {
    this.send('deleteRoom', { roomCode });
  }

  startRoomGame(roomCode: string) {
    this.send('startRoomGame', { roomCode });
  }

  leaveRoom() {
    const roomCode = this.activeRoomCode$.value || this.roomCode$.value;
    if (roomCode) {
      this.send('leaveRoom', { roomCode });
    }
    this.leaveGame();
  }

  leaveGame() {
    this.clearMatchFound();
    if (this.queueState$.value === 'QUEUED') {
      this.cancelMatchmaking();
    }
    if (this.currentGameId) {
      this.ignoredGameIds.add(this.currentGameId);
    }
    this.unsubscribeGameTopic();
    this.unsubscribeRoomTopic();
    this.currentGameId = null;
    this.gameState$.next(null);
    this.yourColor$.next(null);
    this.timeControl$.next(null);
    this.roomCode$.next(null);
    this.drawOffer$.next(false);
    this.activeRoomCode$.next(null);
    this.roomMessages$.next([]);
    this.roomInvite$.next(null);
    this.opponentDisconnected$.next(false);
    this.queueState$.next('IDLE');
    this.listRooms();
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.client) {
      this.unsubscribeCurrentTopics();
      this.client.deactivate();
      this.client = null;
    }
    this.connected$.next(false);
    this.ready$.next(false);
    this.sessionUsername$.next(null);
    this.sessionUserId$.next(null);
    this.connectionState$.next('DISCONNECTED');
    this.awaitingRecoverySnapshot = false;
    this.queueState$.next('IDLE');
    this.opponentDisconnected$.next(false);
  }

  clearLastError() {
    this.lastError$.next(null);
  }

  private subscribeQueue() {
    if (!this.client || this.queueSubscription) {
      return;
    }
    this.queueSubscription = this.client.subscribe('/user/queue/game', (message) => this.handleMessage(message));
  }

  private subscribeGameTopic(gameId: string) {
    if (!this.client || (this.gameSubscription && this.gameSubscriptionId === gameId)) {
      return;
    }
    this.unsubscribeGameTopic();
    this.gameSubscriptionId = gameId;
    this.gameSubscription = this.client.subscribe(`/topic/game/${gameId}`, (message) => this.handleMessage(message));
  }

  private handleMessage(message: IMessage) {
    let event: WsEvent;
    try {
      event = JSON.parse(message.body);
    } catch {
      return;
    }
    switch (event.type) {
      case 'roomCreated':
        this.roomCode$.next(event.payload as string);
        if (event.payload) {
          this.setActiveRoom(String(event.payload));
        }
        break;
      case 'roomJoinFailed':
        this.lastError$.next(String(event.payload ?? 'room_join_failed'));
        break;
      case 'helloAck':
        if (event.payload && typeof event.payload === 'object') {
          const ack = event.payload as HelloAck;
          if (ack.username) {
            this.sessionUsername$.next(ack.username);
          }
          this.sessionUserId$.next(ack.userId ?? null);
          if (ack.reconnectToken) {
            this.currentReconnectToken = ack.reconnectToken;
            this.reconnectToken$.next(ack.reconnectToken);
          }
        }
        this.subscribeRoomAfterAuthentication();
        if (this.awaitingRecoverySnapshot) {
          this.connectionState$.next('RECOVERING_GAME');
          this.ready$.next(false);
          this.requestSync(this.currentGameId ?? undefined);
        } else {
          this.connectionState$.next('READY');
          this.ready$.next(true);
        }
        break;
      case 'helloFailed':
        this.ready$.next(false);
        this.connectionState$.next('ERROR');
        this.lastError$.next(String(event.payload ?? 'hello_failed'));
        this.stopAfterAuthenticationFailure();
        break;
      case 'roomCreateFailed':
        this.lastError$.next(String(event.payload ?? 'room_create_failed'));
        break;
      case 'matchmakingFailed':
        if (event.payload !== 'already_queued') {
          this.queueState$.next('IDLE');
        }
        this.lastError$.next(String(event.payload ?? 'matchmaking_failed'));
        break;
      case 'matchmakingQueued':
        this.queueState$.next('QUEUED');
        this.lastError$.next(null);
        break;
      case 'matchmakingCanceled':
        this.queueState$.next('IDLE');
        break;
      case 'publicRooms':
        this.publicRooms$.next((event.payload as PublicRoomDto[]) ?? []);
        break;
      case 'roomInviteCreated':
        if ((event.payload as RoomInviteDto | null)?.roomCode?.toUpperCase() === this.activeRoomCode$.value) {
          this.roomInvite$.next(event.payload as RoomInviteDto);
        }
        break;
      case 'roomMessage':
        this.handleRoomMessage(event.payload as RoomMessageDto);
        break;
      case 'roomHistory':
        {
          const history = event.payload as RoomHistoryDto;
          if (history?.roomCode?.toUpperCase() === this.activeRoomCode$.value && Array.isArray(history.messages)) {
            this.roomMessages$.next(history.messages);
          }
        }
        break;
      case 'roomParticipants': {
        const payload = event.payload as RoomParticipantsDto;
        if (payload && payload.participants && payload.roomCode?.toUpperCase() === this.activeRoomCode$.value) {
          this.roomParticipants$.next(payload.participants);
        }
        break;
      }
      case 'roomInviteFailed':
        this.lastError$.next(String(event.payload ?? 'room_invite_failed'));
        break;
      case 'roomSpectateFailed':
        this.lastError$.next(String(event.payload ?? 'room_spectate_failed'));
        break;
      case 'roomKickFailed':
        this.lastError$.next(String(event.payload ?? 'room_kick_failed'));
        break;
      case 'roomDeleteFailed':
        this.lastError$.next(String(event.payload ?? 'room_delete_failed'));
        break;
      case 'roomStartFailed':
        this.lastError$.next(String(event.payload ?? 'room_start_failed'));
        break;
      case 'roomKicked':
      case 'roomClosed':
      case 'roomDeleted':
        if (String(event.payload ?? '').toUpperCase() !== this.activeRoomCode$.value) {
          break;
        }
        this.lastError$.next(event.type);
        this.leaveGame();
        break;
      case 'gameStarted':
        this.handleGameStarted(event.payload as GameStartedEvent);
        break;
      case 'moveAccepted':
        this.handleMoveAccepted(event.payload as MoveAcceptedEvent);
        break;
      case 'moveRejected':
        this.handleMoveRejected(event.payload as MoveRejectedEvent);
        break;
      case 'gameStateSync':
        this.handleGameStateSync(event.payload as GameStateSyncEvent);
        break;
      case 'gameEnded':
        this.handleGameEnded(event.payload as GameEndedEvent);
        break;
      case 'opponentDisconnected':
        if ((event.payload as { gameId?: string } | null)?.gameId === this.currentGameId) {
          this.opponentDisconnected$.next(true);
        }
        break;
      case 'opponentReconnected':
        if ((event.payload as { gameId?: string } | null)?.gameId === this.currentGameId) {
          this.opponentDisconnected$.next(false);
        }
        break;
      case 'offerDraw':
        this.drawOffer$.next(true);
        break;
      case 'drawDeclined':
        this.drawOffer$.next(false);
        break;
      case 'drawOfferLimit':
        this.lastError$.next('draw_offer_limit');
        break;
      case 'acceptDraw':
        this.drawOffer$.next(false);
        break;
      default:
        break;
    }
  }

  private handleGameStarted(event: GameStartedEvent) {
    if (!event?.gameId || !event.fen || this.ignoredGameIds.has(event.gameId)) {
      return;
    }
    const current = this.gameState$.value;
    if (current?.gameId === event.gameId) {
      if (event.reconnectToken) {
        this.currentReconnectToken = event.reconnectToken;
        this.reconnectToken$.next(event.reconnectToken);
      }
      this.subscribeGameTopic(event.gameId);
      return;
    }
    if (current?.result === 'ONGOING' && current.gameId !== event.gameId) {
      return;
    }
    this.showMatchFound();
    if (this.currentGameId && this.currentGameId !== event.gameId) {
      this.ignoredGameIds.add(this.currentGameId);
    }
    this.currentGameId = event.gameId;
    this.currentReconnectToken = event.reconnectToken;
    this.subscribeGameTopic(event.gameId);
    this.queueState$.next('IDLE');
    this.opponentDisconnected$.next(false);
    this.roomCode$.next(null);
    this.reconnectToken$.next(event.reconnectToken);
    this.timeControl$.next(event.timeControlType ?? null);
    this.yourColor$.next(event.yourColor ?? null);
    this.drawOffer$.next(false);
    if (event.roomCode) {
      this.setActiveRoom(event.roomCode);
    } else {
      this.clearActiveRoom();
    }
    const initialState: GameStateSyncDto = {
      gameId: event.gameId,
      fen: event.fen,
      sideToMove: event.sideToMove,
      yourColor: event.yourColor ?? null,
      roomCode: event.roomCode ?? null,
      timeControlType: event.timeControlType,
      result: 'ONGOING',
      endReason: 'NONE',
      moves: [],
      whiteTimeLeftMs: event.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs,
      lastMoveAt: event.lastMoveAt ?? null,
      version: event.version ?? null
    };
    if (this.isValidGameSnapshot(initialState)) {
      this.gameState$.next(initialState);
    } else {
      this.lastError$.next('invalid_game_snapshot');
      this.requestSync(event.gameId);
    }
  }

  private showMatchFound() {
    this.clearMatchFound();
    this.matchFound$.next(true);
    this.matchFoundTimer = setTimeout(() => {
      this.matchFoundTimer = null;
      this.matchFound$.next(false);
    }, 1600);
  }

  private clearMatchFound() {
    if (this.matchFoundTimer !== null) {
      clearTimeout(this.matchFoundTimer);
      this.matchFoundTimer = null;
    }
    this.matchFound$.next(false);
  }

  private handleMoveAccepted(event: MoveAcceptedEvent) {
    const current = this.gameState$.value;
    if (!current || current.gameId !== event.gameId) {
      return;
    }
    if (event.version != null && current.version != null) {
      if (event.version <= current.version) {
        return;
      }
      if (event.version !== current.version + 1) {
        this.requestSync(event.gameId);
        return;
      }
    }
    const next: GameStateSyncDto = {
      ...current,
      fen: event.fen,
      sideToMove: event.sideToMove,
      whiteTimeLeftMs: event.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs,
      lastMoveAt: event.lastMoveAt ?? current.lastMoveAt ?? null,
      moves: [...current.moves, event.move],
      analysis: event.analysis ?? current.analysis ?? null,
      version: event.version ?? (current.version == null ? null : current.version + 1)
    };
    if (!this.isValidGameSnapshot(next)) {
      this.requestSync(event.gameId);
      return;
    }
    this.drawOffer$.next(false);
    this.gameState$.next(next);
  }

  private handleMoveRejected(event: MoveRejectedEvent) {
    const current = this.gameState$.value;
    if (!current || current.gameId !== event.gameId) {
      return;
    }
    if (event.version != null && current.version != null && event.version < current.version) {
      return;
    }
    this.lastError$.next(event.reason);
    if (event.version != null && current.version != null && event.version > current.version) {
      this.requestSync(event.gameId);
      return;
    }
    if (event.fen && event.sideToMove) {
      const next: GameStateSyncDto = {
        ...current,
        fen: event.fen,
        sideToMove: event.sideToMove,
        whiteTimeLeftMs: event.whiteTimeLeftMs ?? current.whiteTimeLeftMs,
        blackTimeLeftMs: event.blackTimeLeftMs ?? current.blackTimeLeftMs
      };
      if (this.isValidGameSnapshot(next)) {
        this.gameState$.next(next);
      } else {
        this.requestSync(event.gameId);
      }
    }
  }

  private handleGameStateSync(event: GameStateSyncEvent) {
    const state = event?.state;
    if (!this.isValidGameSnapshot(state)) {
      this.lastError$.next('invalid_game_snapshot');
      return;
    }
    if (this.ignoredGameIds.has(state.gameId)) {
      return;
    }
    const current = this.gameState$.value;
    if (current?.result === 'ONGOING' && current.gameId !== state.gameId && !this.awaitingRecoverySnapshot) {
      return;
    }
    if (current?.gameId === state.gameId
        && current.version != null
        && state.version != null
        && state.version < current.version) {
      return;
    }
    if (this.currentGameId && this.currentGameId !== state.gameId) {
      this.ignoredGameIds.add(this.currentGameId);
    }
    this.currentGameId = state.gameId;
    this.ignoredGameIds.delete(state.gameId);
    this.subscribeGameTopic(state.gameId);
    this.yourColor$.next(state.yourColor ?? null);
    if (state.roomCode) {
      this.setActiveRoom(state.roomCode);
    } else if (current?.gameId !== state.gameId) {
      this.clearActiveRoom();
    }
    this.timeControl$.next(state.timeControlType ?? this.timeControl$.value);
    this.gameState$.next(state);
    this.opponentDisconnected$.next(false);
    if (this.awaitingRecoverySnapshot) {
      this.awaitingRecoverySnapshot = false;
      this.connectionState$.next('READY');
      this.ready$.next(true);
    }
  }

  private handleGameEnded(event: GameEndedEvent) {
    const current = this.gameState$.value;
    if (!current || current.gameId !== event.gameId) {
      return;
    }
    if (event.version != null && current.version != null && event.version <= current.version) {
      return;
    }
    const next: GameStateSyncDto = {
      ...current,
      result: event.result,
      endReason: event.endReason,
      fen: event.fen ?? current.fen,
      sideToMove: event.sideToMove ?? current.sideToMove,
      whiteTimeLeftMs: event.whiteTimeLeftMs ?? current.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs ?? current.blackTimeLeftMs,
      moves: event.moves ?? current.moves,
      version: event.version ?? current.version ?? null
    };
    if (!this.isValidGameSnapshot(next)) {
      this.requestSync(event.gameId);
      return;
    }
    this.drawOffer$.next(false);
    this.gameState$.next(next);
  }

  private handleRoomMessage(message: RoomMessageDto) {
    if (!message || message.roomCode?.toUpperCase() !== this.activeRoomCode$.value) {
      return;
    }
    const current = this.roomMessages$.value;
    this.roomMessages$.next([...current, message].slice(-100));
  }

  private send(destination: string, payload: unknown) {
    if (!this.client || !this.client.connected) {
      return;
    }
    if (destination !== 'hello/auth' && destination !== 'requestSync' && !this.ready$.value) {
      return;
    }
    this.client.publish({
      destination: `/app/${destination}`,
      body: JSON.stringify(payload)
    });
  }

  private resolveWsUrl() {
    const origin = window.location.origin;
    if (origin.includes('localhost:4200')) {
      return 'http://localhost:8080/ws';
    }
    return `${origin}/ws`;
  }

  private subscribeLobby() {
    if (!this.client || this.lobbySubscription) {
      return;
    }
    this.lobbySubscription = this.client.subscribe('/topic/lobby', (message) => this.handleMessage(message));
  }

  private setActiveRoom(roomCode: string) {
    const normalized = roomCode?.trim()?.toUpperCase();
    if (!normalized) {
      return;
    }
    if (this.activeRoomCode$.value === normalized) {
      return;
    }
    this.activeRoomCode$.next(normalized);
    this.roomInvite$.next(null);
    this.roomMessages$.next([]);
    this.roomParticipants$.next([]);
    this.subscribeRoomTopic(normalized);
    this.roomHistory(normalized);
    this.roomParticipants(normalized);
  }

  private subscribeRoomTopic(roomCode: string) {
    if (!this.client || (this.roomSubscription && this.roomSubscriptionCode === roomCode)) {
      return;
    }
    if (this.roomSubscription) {
      this.roomSubscription.unsubscribe();
      this.roomSubscription = null;
    }
    this.roomSubscriptionCode = roomCode;
    this.roomSubscription = this.client.subscribe(`/topic/room/${roomCode}`, (message) => this.handleMessage(message));
  }

  private unsubscribeRoomTopic() {
    this.roomSubscription?.unsubscribe();
    this.roomSubscription = null;
    this.roomSubscriptionCode = null;
  }

  private clearActiveRoom() {
    this.unsubscribeRoomTopic();
    this.activeRoomCode$.next(null);
    this.roomCode$.next(null);
    this.roomMessages$.next([]);
    this.roomParticipants$.next([]);
    this.roomInvite$.next(null);
  }

  private subscribeRoomAfterAuthentication() {
    const roomCode = this.activeRoomCode$.value;
    if (!roomCode) {
      return;
    }
    this.subscribeRoomTopic(roomCode);
    this.roomHistory(roomCode);
    this.roomParticipants(roomCode);
  }

  private unsubscribeGameTopic() {
    this.gameSubscription?.unsubscribe();
    this.gameSubscription = null;
    this.gameSubscriptionId = null;
  }

  private unsubscribeCurrentTopics() {
    this.queueSubscription?.unsubscribe();
    this.lobbySubscription?.unsubscribe();
    this.unsubscribeRoomTopic();
    this.unsubscribeGameTopic();
    this.queueSubscription = null;
    this.lobbySubscription = null;
  }

  private resetSubscriptionHandles() {
    this.queueSubscription = null;
    this.lobbySubscription = null;
    this.roomSubscription = null;
    this.roomSubscriptionCode = null;
    this.gameSubscription = null;
    this.gameSubscriptionId = null;
  }

  private stopAfterAuthenticationFailure() {
    const failedClient = this.client;
    if (!failedClient) {
      return;
    }
    this.manualDisconnect = true;
    this.resetSubscriptionHandles();
    this.client = null;
    void failedClient.deactivate().finally(() => {
      this.manualDisconnect = false;
      this.connectionState$.next('ERROR');
      this.ready$.next(false);
      this.connected$.next(false);
    });
  }

  private isValidGameSnapshot(state: GameStateSyncDto | null | undefined): state is GameStateSyncDto {
    if (!state || typeof state.gameId !== 'string' || !state.gameId.trim()
        || typeof state.fen !== 'string' || !Array.isArray(state.moves)
        || !['WHITE', 'BLACK'].includes(state.sideToMove)
        || !['ONGOING', 'WHITE_WIN', 'BLACK_WIN', 'DRAW'].includes(state.result)
        || !['NONE', 'CHECKMATE', 'STALEMATE', 'RESIGNATION', 'TIME_OUT', 'DISCONNECT_TIMEOUT',
          'AGREED_DRAW', 'THREEFOLD_REPETITION', 'FIFTY_MOVE_RULE', 'INSUFFICIENT_MATERIAL']
          .includes(state.endReason)
        || (state.timeControlType != null
          && !['UNTIMED', 'BULLET', 'BLITZ', 'RAPID', 'CLASSICAL'].includes(state.timeControlType))
        || !Number.isFinite(state.whiteTimeLeftMs) || state.whiteTimeLeftMs < 0
        || !Number.isFinite(state.blackTimeLeftMs) || state.blackTimeLeftMs < 0
        || (state.version != null && (!Number.isInteger(state.version) || state.version < 0))) {
      return false;
    }

    try {
      const replay = new Chess();
      for (const move of state.moves) {
        if (!move || !/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to)
            || !['WHITE', 'BLACK'].includes(move.playerColor)
            || move.playerColor !== (replay.turn() === 'w' ? 'WHITE' : 'BLACK')
            || (move.promotion != null && !['q', 'r', 'b', 'n'].includes(move.promotion.toLowerCase()))) {
          return false;
        }
        replay.move({
          from: move.from as Square,
          to: move.to as Square,
          promotion: move.promotion?.toLowerCase() as 'q' | 'r' | 'b' | 'n' | undefined
        });
      }
      const actualFen = replay.fen().split(' ');
      const expectedFen = state.fen.split(' ');
      return actualFen.length === 6 && expectedFen.length === 6
        && state.sideToMove === (replay.turn() === 'w' ? 'WHITE' : 'BLACK')
        && [0, 1, 2, 4, 5].every((index) => actualFen[index] === expectedFen[index])
        && (actualFen[3] === expectedFen[3]
          || replay.history({ verbose: true }).some((playedMove) => playedMove.flags.includes('e')));
    } catch {
      return false;
    }
  }
}
