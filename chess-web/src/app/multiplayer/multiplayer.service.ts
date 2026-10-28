import { Injectable } from '@angular/core';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
// The server exposes this endpoint with Spring's withSockJS(), which keeps SockJS fallbacks available.
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
  RoomLifecycleEvent,
  RoomRecoveryCredential,
  RoomParticipantDto,
  HelloAck,
  MultiplayerConnectionState,
  MatchmakingQueueState,
  TimeControlType,
  WsEvent
} from './models';

type GameUpdateKind = 'MOVE_ACCEPTED' | 'GAME_ENDED' | 'GAME_STATE_SYNC';
type GameUpdateDecision = 'APPLY' | 'DUPLICATE' | 'STALE' | 'RESYNC';
const MAX_AUTHORITATIVE_RESYNC_REQUESTS = 3;

@Injectable({ providedIn: 'root' })
export class MultiplayerService {
  private static readonly MAX_RECONNECT_ATTEMPTS = 8;
  private static readonly HELLO_ACK_TIMEOUT_MS = 5000;
  private client: Client | null = null;
  private currentGameId: string | null = null;
  private readonly ignoredGameIds = new Set<string>();
  private readonly handledRoomLifecycleEvents = new Set<string>();
  private roomSubscription: StompSubscription | null = null;
  private roomSubscriptionCode: string | null = null;
  private gameSubscription: StompSubscription | null = null;
  private gameSubscriptionId: string | null = null;
  private queueSubscription: StompSubscription | null = null;
  private lobbySubscription: StompSubscription | null = null;
  private connectionUsername: string | null = null;
  private pendingRoomJoinCode: string | null = null;
  private pendingRoomSpectateCode: string | null = null;
  private currentReconnectToken: string | null = this.readSessionValue('onlineReconnect');
  private currentRoomReconnectToken: string | null = this.readSessionValue('roomReconnectToken');
  private reconnectAttempts = 0;
  private helloAckRetries = 0;
  private helloAckTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingHelloAck = false;
  private matchFoundTimer: ReturnType<typeof setTimeout> | null = null;
  private everConnected = false;
  private awaitingRecoverySnapshot = false;
  private resyncGameId: string | null = null;
  private resyncAttempts = 0;
  private manualDisconnect = false;

  readonly connected$ = new BehaviorSubject<boolean>(false);
  readonly connectionState$ = new BehaviorSubject<MultiplayerConnectionState>('DISCONNECTED');
  readonly opponentDisconnected$ = new BehaviorSubject<boolean>(false);
  readonly queueState$ = new BehaviorSubject<MatchmakingQueueState>('IDLE');
  readonly matchFound$ = new BehaviorSubject<boolean>(false);
  readonly roomCode$ = new BehaviorSubject<string | null>(null);
  readonly gameState$ = new BehaviorSubject<GameStateSyncDto | null>(null);
  readonly lastError$ = new BehaviorSubject<string | null>(null);
  readonly timeControl$ = new BehaviorSubject<TimeControlType | null>(null);
  readonly yourColor$ = new BehaviorSubject<'WHITE' | 'BLACK' | null>(null);
  readonly publicRooms$ = new BehaviorSubject<PublicRoomDto[]>([]);
  readonly drawOffer$ = new BehaviorSubject<boolean>(false);
  readonly activeRoomCode$ = new BehaviorSubject<string | null>(this.readSessionValue('roomRecoveryRoomCode'));
  readonly roomMessages$ = new BehaviorSubject<RoomMessageDto[]>([]);
  readonly roomInvite$ = new BehaviorSubject<RoomInviteDto | null>(null);
  readonly ready$ = new BehaviorSubject<boolean>(false);
  readonly sessionUsername$ = new BehaviorSubject<string | null>(null);
  readonly sessionUserId$ = new BehaviorSubject<number | null>(null);
  readonly roomParticipants$ = new BehaviorSubject<RoomParticipantDto[]>([]);

  connect(username?: string) {
    if (username !== undefined) {
      this.connectionUsername = username ?? null;
    }
    if (this.client && this.client.active) {
      return;
    }
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.helloAckRetries = 0;
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
        this.awaitingHelloAck = true;
        this.subscribeQueue();
        this.subscribeLobby();
        this.scheduleHelloAckTimeout();
        this.send('hello/auth', {
          username: this.connectionUsername,
          reconnectToken: this.currentReconnectToken,
          roomReconnectToken: this.currentRoomReconnectToken
        });
      },
      onStompError: () => {
        this.lastError$.next('stomp_error');
      },
      onWebSocketClose: () => {
        this.clearHelloAckTimeout();
        this.awaitingHelloAck = false;
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
    const normalized = roomCode?.trim()?.toUpperCase();
    if (!normalized) return;
    const activeRoom = this.activeRoomCode$.value;
    if (activeRoom && activeRoom !== normalized) {
      this.lastError$.next('already_in_room');
      return;
    }
    this.pendingRoomJoinCode = normalized;
    this.send('joinRoom', { roomCode: normalized, password: password ?? null, inviteToken: inviteToken ?? null });
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
    if (!current || current.gameId !== gameId || current.result !== 'ONGOING') {
      return;
    }
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
    const normalized = roomCode?.trim()?.toUpperCase();
    if (!normalized) return;
    const activeRoom = this.activeRoomCode$.value;
    if (activeRoom && activeRoom !== normalized) {
      this.lastError$.next('already_in_room');
      return;
    }
    this.pendingRoomSpectateCode = normalized;
    this.send('spectateRoom', { roomCode: normalized });
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
    this.setRoomReconnectToken(null);
    this.writeSessionValue('roomRecoveryRoomCode', null);
    this.roomCode$.next(null);
    this.drawOffer$.next(false);
    this.activeRoomCode$.next(null);
    this.roomMessages$.next([]);
    this.pendingRoomJoinCode = null;
    this.pendingRoomSpectateCode = null;
    this.roomParticipants$.next([]);
    this.roomInvite$.next(null);
    this.opponentDisconnected$.next(false);
    this.queueState$.next('IDLE');
    this.listRooms();
  }

  disconnect() {
    this.clearMatchFound();
    this.manualDisconnect = true;
    this.clearHelloAckTimeout();
    this.awaitingHelloAck = false;
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
      case 'roomOpen': {
        const lifecycle = event.payload as RoomLifecycleEvent;
        if (lifecycle?.roomCode) this.setActiveRoom(lifecycle.roomCode);
        break;
      }
      case 'roomRecovery': {
        const credential = event.payload as RoomRecoveryCredential;
        if (credential?.roomCode && credential.reconnectToken) {
          const normalized = credential.roomCode.trim().toUpperCase();
          const pendingRoom = this.pendingRoomJoinCode ?? this.pendingRoomSpectateCode;
          if (pendingRoom && pendingRoom !== normalized) break;
          if (!pendingRoom && this.activeRoomCode$.value !== normalized) break;
          this.pendingRoomJoinCode = null;
          this.pendingRoomSpectateCode = null;
          if (this.activeRoomCode$.value === normalized) {
            this.subscribeRoomTopic(normalized);
            this.roomHistory(normalized);
            this.roomParticipants(normalized);
          } else {
            this.setActiveRoom(normalized);
          }
          this.setRoomReconnectToken(credential.reconnectToken);
        }
        break;
      }
      case 'roomJoinFailed': {
        const pendingRoom = this.pendingRoomJoinCode;
        if (pendingRoom && this.activeRoomCode$.value !== pendingRoom
            && this.roomSubscriptionCode === pendingRoom) {
          this.unsubscribeRoomTopic();
        }
        this.pendingRoomJoinCode = null;
        this.lastError$.next(String(event.payload ?? 'room_join_failed'));
        break;
      }
      case 'roomSpectateFailed': {
        const pendingRoom = this.pendingRoomSpectateCode;
        if (pendingRoom && this.activeRoomCode$.value !== pendingRoom
            && this.roomSubscriptionCode === pendingRoom) {
          this.unsubscribeRoomTopic();
        }
        this.pendingRoomSpectateCode = null;
        this.lastError$.next(String(event.payload ?? 'room_spectate_failed'));
        break;
      }
      case 'helloAck':
        this.clearHelloAckTimeout();
        this.awaitingHelloAck = false;
        this.helloAckRetries = 0;
        if (event.payload && typeof event.payload === 'object') {
          const ack = event.payload as HelloAck;
          if (ack.username) {
            this.sessionUsername$.next(ack.username);
          }
          this.sessionUserId$.next(ack.userId ?? null);
          if (ack.reconnectToken) {
            this.setReconnectToken(ack.reconnectToken);
          }
          if (ack.roomReconnectToken) {
            this.setRoomReconnectToken(ack.roomReconnectToken);
          }
          if (ack.reconnectAckId && ack.gameId) {
            this.send('ackReconnect', { gameId: ack.gameId, ackId: ack.reconnectAckId });
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
        this.clearHelloAckTimeout();
        this.awaitingHelloAck = false;
        this.ready$.next(false);
        this.connectionState$.next('ERROR');
        if (event.payload === 'invalid_reconnect_token') {
          this.setReconnectToken(null);
          this.awaitingRecoverySnapshot = false;
        }
        if (event.payload === 'invalid_room_reconnect_token') {
          this.setRoomReconnectToken(null);
          this.writeSessionValue('roomRecoveryRoomCode', null);
          this.activeRoomCode$.next(null);
          this.roomCode$.next(null);
        }
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
          if (payload.memberEvent === 'ROOM_CLOSED' && payload.roomStatus === 'CLOSED'
              && payload.closeReason !== 'GAME_FINISHED') {
            this.handleRoomTerminal('roomClosed', payload);
            break;
          }
          if (payload.memberEvent === 'PARTICIPANT_KICKED') {
            this.handleRoomTerminal('roomKicked', payload);
            break;
          }
          this.roomParticipants$.next(payload.participants);
        }
        break;
      }
      case 'roomInviteFailed':
        this.lastError$.next(String(event.payload ?? 'room_invite_failed'));
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
        this.handleRoomTerminal(event.type, event.payload);
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
      if (!this.currentReconnectToken && event.reconnectToken) {
        this.setReconnectToken(event.reconnectToken);
      }
      this.subscribeGameTopic(event.gameId);
      return;
    }
    if (current?.result === 'ONGOING' && current.gameId !== event.gameId) {
      return;
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
      version: event.version
    };
    if (!this.isValidGameSnapshot(initialState)) {
      this.requestAuthoritativeSync(event.gameId, 'invalid_game_snapshot');
      return;
    }

    this.showMatchFound();
    if (this.currentGameId && this.currentGameId !== event.gameId) {
      this.ignoredGameIds.add(this.currentGameId);
    }
    this.currentGameId = event.gameId;
    this.setReconnectToken(event.reconnectToken ?? null);
    this.subscribeGameTopic(event.gameId);
    this.queueState$.next('IDLE');
    this.opponentDisconnected$.next(false);
    this.roomCode$.next(null);
    this.timeControl$.next(event.timeControlType ?? null);
    this.yourColor$.next(event.yourColor ?? null);
    this.drawOffer$.next(false);
    if (event.roomCode) {
      this.setActiveRoom(event.roomCode);
    } else {
      this.clearActiveRoom();
    }
    this.gameState$.next(initialState);
    this.resetAuthoritativeResync(event.gameId);
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
    const next: GameStateSyncDto = {
      ...current,
      fen: event.fen,
      sideToMove: event.sideToMove,
      whiteTimeLeftMs: event.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs,
      lastMoveAt: event.lastMoveAt ?? current.lastMoveAt ?? null,
      moves: [...current.moves, event.move],
      analysis: event.analysis ?? current.analysis ?? null,
      version: event.version
    };
    const decision = this.reconcileGameUpdate(current, next, 'MOVE_ACCEPTED', event);
    if (decision !== 'APPLY') {
      if (decision === 'RESYNC') this.requestAuthoritativeSync(event.gameId);
      return;
    }
    if (!this.isValidGameSnapshot(next, true)) {
      this.requestAuthoritativeSync(event.gameId, 'invalid_game_snapshot');
      return;
    }
    this.drawOffer$.next(false);
    this.gameState$.next(next);
    this.resetAuthoritativeResync(event.gameId);
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
      this.requestAuthoritativeSync(event.gameId);
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
        this.resetAuthoritativeResync(event.gameId);
      } else {
        this.requestAuthoritativeSync(event.gameId, 'invalid_game_snapshot');
      }
    }
  }

  private handleGameStateSync(event: GameStateSyncEvent) {
    const state = event?.state;
    if (!state) {
      this.requestAuthoritativeSync(this.currentGameId ?? this.gameState$.value?.gameId ?? '', 'invalid_game_snapshot');
      return;
    }
    if (this.ignoredGameIds.has(state.gameId)) {
      return;
    }
    const current = this.gameState$.value;
    let snapshotDecision: GameUpdateDecision = 'APPLY';
    if (current?.result === 'ONGOING' && current.gameId !== state.gameId && !this.awaitingRecoverySnapshot) {
      return;
    }
    if (current?.gameId === state.gameId) {
      snapshotDecision = this.reconcileGameUpdate(current, state, 'GAME_STATE_SYNC');
      if (snapshotDecision === 'RESYNC') {
        this.requestAuthoritativeSync(state.gameId);
        return;
      }
      if (snapshotDecision === 'STALE') return;
      if (snapshotDecision === 'DUPLICATE' && !this.awaitingRecoverySnapshot) return;
    }
    const incomingGameId = state.gameId;
    if (!this.isValidGameSnapshot(state)) {
      this.requestAuthoritativeSync(incomingGameId, 'invalid_game_snapshot');
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
    if (snapshotDecision === 'APPLY') {
      this.gameState$.next(state);
    }
    this.resetAuthoritativeResync(state.gameId);
    if (this.lastError$.value === 'state_conflict' || this.lastError$.value === 'invalid_game_snapshot'
        || this.lastError$.value === 'snapshot_recovery_failed') {
      this.lastError$.next(null);
    }
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
    const next: GameStateSyncDto = {
      ...current,
      result: event.result,
      endReason: event.endReason,
      fen: event.fen,
      sideToMove: event.sideToMove,
      whiteTimeLeftMs: event.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs,
      moves: event.moves,
      version: event.version
    };
    const decision = this.reconcileGameUpdate(current, next, 'GAME_ENDED');
    if (decision !== 'APPLY') {
      if (decision === 'RESYNC') this.requestAuthoritativeSync(event.gameId);
      return;
    }
    if (!this.isValidGameSnapshot(next)) {
      this.requestAuthoritativeSync(event.gameId, 'invalid_game_snapshot');
      return;
    }
    this.drawOffer$.next(false);
    this.gameState$.next(next);
    this.resetAuthoritativeResync(event.gameId);
  }

  /**
   * Version orders committed updates; terminality is a separate, irreversible state transition.
   * The full gameEnded payload and gameStateSync are canonical snapshots, so they may finalize
   * an ONGOING state at the same version only for a move-terminal reason when position, history,
   * clocks, and last-move time agree with the committed move event.
   */
  private reconcileGameUpdate(
    current: GameStateSyncDto,
    incoming: GameStateSyncDto,
    kind: GameUpdateKind,
    moveEvent?: MoveAcceptedEvent
  ): GameUpdateDecision {
    const currentVersion = current.version ?? null;
    const incomingVersion = incoming.version ?? null;

    if (currentVersion != null && incomingVersion != null && incomingVersion < currentVersion) {
      return 'STALE';
    }

    if (kind === 'MOVE_ACCEPTED') {
      if (moveEvent?.version == null || (currentVersion != null && incomingVersion == null)) return 'RESYNC';
      if (currentVersion != null && incomingVersion === currentVersion) {
        return moveEvent && this.moveEventMatchesCurrent(current, moveEvent) ? 'DUPLICATE' : 'RESYNC';
      }
      if (current.result !== 'ONGOING') return 'RESYNC';
      if (currentVersion != null && incomingVersion != null && incomingVersion !== currentVersion + 1) {
        return 'RESYNC';
      }
      if (currentVersion == null && incomingVersion == null
          && incoming.moves.length !== current.moves.length + 1) {
        return 'RESYNC';
      }
      return 'APPLY';
    }

    if (currentVersion != null && incomingVersion == null) return 'RESYNC';
    if (current.result !== 'ONGOING') {
      if (incoming.result === 'ONGOING') return 'RESYNC';
      if (currentVersion === incomingVersion) {
        return this.sameAuthoritativeSnapshot(current, incoming) ? 'DUPLICATE' : 'RESYNC';
      }
      return this.sameTerminalOutcomeAndPosition(current, incoming) ? 'APPLY' : 'RESYNC';
    }

    if (currentVersion === incomingVersion) {
      if (this.sameAuthoritativeSnapshot(current, incoming)) return 'DUPLICATE';
      if (incoming.result !== 'ONGOING' && this.isMoveTerminalReason(incoming.endReason)
          && this.samePositionAndClocks(current, incoming)) return 'APPLY';
      return 'RESYNC';
    }

    return 'APPLY';
  }

  private moveEventMatchesCurrent(current: GameStateSyncDto, event: MoveAcceptedEvent): boolean {
    const lastMove = current.moves[current.moves.length - 1];
    return !!lastMove
      && this.sameMove(lastMove, event.move)
      && current.fen === event.fen
      && current.sideToMove === event.sideToMove
      && current.whiteTimeLeftMs === event.whiteTimeLeftMs
      && current.blackTimeLeftMs === event.blackTimeLeftMs
      && (current.result !== 'ONGOING' || !current.lastMoveAt || !event.lastMoveAt
        || this.sameInstant(current.lastMoveAt, event.lastMoveAt));
  }

  private sameMove(left: MoveAcceptedEvent['move'], right: MoveAcceptedEvent['move']): boolean {
    return !!left && !!right && left.from === right.from && left.to === right.to
      && (left.promotion ?? null) === (right.promotion ?? null)
      && left.playerColor === right.playerColor;
  }

  private samePositionAndHistory(left: GameStateSyncDto, right: GameStateSyncDto): boolean {
    return left.gameId === right.gameId
      && left.fen === right.fen
      && left.sideToMove === right.sideToMove
      && left.moves.length === right.moves.length
      && left.moves.every((move, index) => this.sameMove(move, right.moves[index]));
  }

  private samePositionAndClocks(left: GameStateSyncDto, right: GameStateSyncDto): boolean {
    return this.samePositionAndHistory(left, right)
      && left.whiteTimeLeftMs === right.whiteTimeLeftMs
      && left.blackTimeLeftMs === right.blackTimeLeftMs
      && this.sameInstant(left.lastMoveAt, right.lastMoveAt);
  }

  private sameInstant(left: string | null | undefined, right: string | null | undefined): boolean {
    if (left == null || right == null) return left === right;
    const leftMillis = Date.parse(left);
    const rightMillis = Date.parse(right);
    return Number.isFinite(leftMillis) && leftMillis === rightMillis;
  }

  private isMoveTerminalReason(reason: GameStateSyncDto['endReason']): boolean {
    return ['CHECKMATE', 'STALEMATE', 'THREEFOLD_REPETITION', 'FIFTY_MOVE_RULE',
      'INSUFFICIENT_MATERIAL', 'TIME_OUT'].includes(reason);
  }

  private sameTerminalOutcomeAndPosition(left: GameStateSyncDto, right: GameStateSyncDto): boolean {
    return left.result === right.result && left.endReason === right.endReason
      && this.samePositionAndClocks(left, right);
  }

  private sameAuthoritativeSnapshot(left: GameStateSyncDto, right: GameStateSyncDto): boolean {
    return left.version === right.version
      && left.result === right.result
      && left.endReason === right.endReason
      && left.whiteTimeLeftMs === right.whiteTimeLeftMs
      && left.blackTimeLeftMs === right.blackTimeLeftMs
      && this.sameInstant(left.lastMoveAt, right.lastMoveAt)
      && left.timeControlType === right.timeControlType
      && left.roomCode === right.roomCode
      && this.samePositionAndHistory(left, right);
  }

  private requestAuthoritativeSync(gameId: string, reason = 'state_conflict') {
    if (!gameId) {
      this.lastError$.next('snapshot_recovery_failed');
      return;
    }
    if (this.resyncGameId !== gameId) {
      this.resyncGameId = gameId;
      this.resyncAttempts = 0;
    }
    if (this.resyncAttempts >= MAX_AUTHORITATIVE_RESYNC_REQUESTS) {
      this.lastError$.next('snapshot_recovery_failed');
      return;
    }
    this.resyncAttempts++;
    this.lastError$.next(reason);
    this.requestSync(gameId);
  }

  private resetAuthoritativeResync(gameId: string) {
    this.resyncGameId = gameId;
    this.resyncAttempts = 0;
  }

  private handleRoomTerminal(eventName: 'roomClosed' | 'roomKicked' | 'roomDeleted', payload: unknown) {
    const details = payload && typeof payload === 'object'
      ? payload as Partial<RoomLifecycleEvent> & Partial<RoomParticipantsDto>
      : null;
    const roomCode = typeof payload === 'string' ? payload : details?.roomCode;
    const activeRoom = this.activeRoomCode$.value || this.roomCode$.value;
    if (!roomCode || roomCode.trim().toUpperCase() !== activeRoom?.trim().toUpperCase()) return;

    const lifecycleType = details?.type ?? details?.memberEvent ?? eventName;
    const lifecycleAt = details?.occurredAt ?? details?.lifecycleAt ?? '';
    const closeReason = details?.closeReason ?? '';
    const eventKey = `${roomCode.toUpperCase()}:${lifecycleType}:${lifecycleAt}:${closeReason}`;
    if (this.handledRoomLifecycleEvents.has(eventKey)) return;
    this.handledRoomLifecycleEvents.add(eventKey);
    if (this.handledRoomLifecycleEvents.size > 64) {
      const oldest = this.handledRoomLifecycleEvents.values().next().value;
      if (oldest) this.handledRoomLifecycleEvents.delete(oldest);
    }

    if (eventName === 'roomKicked') {
      this.lastError$.next('roomKicked');
    } else if (eventName === 'roomDeleted') {
      this.lastError$.next('roomDeleted');
    } else {
      const reasonKey = closeReason ? String(closeReason).toLowerCase() : '';
      this.lastError$.next(reasonKey ? `room_closed_${reasonKey}` : 'roomClosed');
    }
    this.leaveGame();
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
    if (destination !== 'hello/auth' && destination !== 'requestSync'
        && destination !== 'ackReconnect' && !this.ready$.value) {
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
    this.setRoomReconnectToken(null);
    this.activeRoomCode$.next(normalized);
    this.writeSessionValue('roomRecoveryRoomCode', normalized);
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
    this.pendingRoomJoinCode = null;
    this.pendingRoomSpectateCode = null;
    this.setRoomReconnectToken(null);
    this.writeSessionValue('roomRecoveryRoomCode', null);
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

  private readSessionValue(key: string): string | null {
    try {
      return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeSessionValue(key: string, value: string | null) {
    try {
      if (typeof window === 'undefined') return;
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable in private browsing; in-memory recovery still works.
    }
  }

  private setRoomReconnectToken(token: string | null) {
    this.currentRoomReconnectToken = token;
    this.writeSessionValue('roomReconnectToken', token);
  }

  private setReconnectToken(token: string | null) {
    this.currentReconnectToken = token;
    this.writeSessionValue('onlineReconnect', token);
  }

  private scheduleHelloAckTimeout() {
    this.clearHelloAckTimeout();
    this.helloAckTimer = setTimeout(() => {
      this.helloAckTimer = null;
      if (!this.awaitingHelloAck || !this.client?.active) return;
      this.helloAckRetries++;
      if (this.helloAckRetries >= MultiplayerService.MAX_RECONNECT_ATTEMPTS) {
        this.awaitingHelloAck = false;
        this.lastError$.next('reconnect_ack_timeout');
        this.ready$.next(false);
        this.manualDisconnect = true;
        const failedClient = this.client;
        this.client = null;
        void failedClient.deactivate().finally(() => {
          this.manualDisconnect = false;
          this.connectionState$.next('ERROR');
          this.connected$.next(false);
        });
        return;
      }
      this.client.forceDisconnect();
    }, MultiplayerService.HELLO_ACK_TIMEOUT_MS);
  }

  private clearHelloAckTimeout() {
    if (this.helloAckTimer !== null) {
      clearTimeout(this.helloAckTimer);
      this.helloAckTimer = null;
    }
  }

  private stopAfterAuthenticationFailure() {
    this.clearHelloAckTimeout();
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

  private isValidGameSnapshot(state: GameStateSyncDto | null | undefined,
                              allowPendingMoveTerminal = false): state is GameStateSyncDto {
    if (!state || typeof state.gameId !== 'string' || !state.gameId.trim()
        || typeof state.fen !== 'string' || !Array.isArray(state.moves)
        || !['WHITE', 'BLACK'].includes(state.sideToMove)
        || !['ONGOING', 'WHITE_WIN', 'BLACK_WIN', 'DRAW'].includes(state.result)
        || !['NONE', 'CHECKMATE', 'STALEMATE', 'RESIGNATION', 'TIME_OUT', 'DISCONNECT_TIMEOUT',
          'AGREED_DRAW', 'THREEFOLD_REPETITION', 'FIFTY_MOVE_RULE', 'INSUFFICIENT_MATERIAL']
          .includes(state.endReason)
        || (state.result === 'ONGOING') !== (state.endReason === 'NONE')
        || (state.timeControlType != null
          && !['UNTIMED', 'BULLET', 'BLITZ', 'RAPID', 'CLASSICAL'].includes(state.timeControlType))
        || !Number.isFinite(state.whiteTimeLeftMs) || state.whiteTimeLeftMs < 0
        || !Number.isFinite(state.blackTimeLeftMs) || state.blackTimeLeftMs < 0
        || !Number.isSafeInteger(state.version) || state.version < 0
        || state.moves.length > 10_000
        || state.version < state.moves.length || state.version > state.moves.length + 1
        || (state.result === 'ONGOING' && state.version !== state.moves.length)) {
      return false;
    }

    try {
      const replay = new Chess();
      let doublePawnPushTarget: string | null = null;
      for (const move of state.moves) {
        if (!move || !/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to)
            || !['WHITE', 'BLACK'].includes(move.playerColor)
            || move.playerColor !== (replay.turn() === 'w' ? 'WHITE' : 'BLACK')
            || (move.promotion != null && !['q', 'r', 'b', 'n'].includes(move.promotion.toLowerCase()))) {
          return false;
        }
        const movingPiece = replay.get(move.from as Square);
        const rankDistance = Number(move.to[1]) - Number(move.from[1]);
        doublePawnPushTarget = movingPiece?.type === 'p' && Math.abs(rankDistance) === 2
          ? `${move.from[0]}${(Number(move.from[1]) + Number(move.to[1])) / 2}` : null;
        replay.move({
          from: move.from as Square,
          to: move.to as Square,
          promotion: move.promotion?.toLowerCase() as 'q' | 'r' | 'b' | 'n' | undefined
        });
      }
      const canonicalFen = replay.fen().split(' ');
      const forcedEnPassantFen = replay.fen({ forceEnpassantSquare: true }).split(' ');
      const expectedFen = state.fen.split(' ');
      return canonicalFen.length === 6 && forcedEnPassantFen.length === 6 && expectedFen.length === 6
        && state.sideToMove === (replay.turn() === 'w' ? 'WHITE' : 'BLACK')
        && [0, 1, 2, 4, 5].every((index) => canonicalFen[index] === expectedFen[index])
        && [canonicalFen[3], forcedEnPassantFen[3], doublePawnPushTarget].includes(expectedFen[3])
        && this.isValidSnapshotOutcome(state, replay, allowPendingMoveTerminal);
    } catch {
      return false;
    }
  }

  private isValidSnapshotOutcome(state: GameStateSyncDto, replay: Chess,
                                 allowPendingMoveTerminal: boolean): boolean {
    if (state.result === 'ONGOING') {
      return state.endReason === 'NONE'
        && (!replay.isGameOver() || allowPendingMoveTerminal && state.version === state.moves.length);
    }

    const noAutomaticResult = !replay.isGameOver();
    switch (state.endReason) {
      case 'CHECKMATE':
        return state.version === state.moves.length && replay.isCheckmate()
          && state.result === (replay.turn() === 'w' ? 'BLACK_WIN' : 'WHITE_WIN');
      case 'STALEMATE':
        return state.version === state.moves.length && replay.isStalemate() && state.result === 'DRAW';
      case 'INSUFFICIENT_MATERIAL':
        return state.version === state.moves.length && replay.isInsufficientMaterial() && state.result === 'DRAW';
      case 'THREEFOLD_REPETITION':
        return state.version === state.moves.length && replay.isThreefoldRepetition() && state.result === 'DRAW';
      case 'FIFTY_MOVE_RULE':
        return state.version === state.moves.length && replay.isDrawByFiftyMoves() && state.result === 'DRAW';
      case 'AGREED_DRAW':
        return noAutomaticResult && state.result === 'DRAW';
      case 'RESIGNATION':
      case 'TIME_OUT':
        return noAutomaticResult && state.result !== 'DRAW';
      case 'DISCONNECT_TIMEOUT':
        return noAutomaticResult;
      default:
        return false;
    }
  }
}
