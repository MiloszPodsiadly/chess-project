import { Injectable } from '@angular/core';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { BehaviorSubject } from 'rxjs';
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
  RoomMessageDto,
  RoomParticipantsDto,
  RoomParticipantDto,
  HelloAck,
  TimeControlType,
  WsEvent
} from './models';

@Injectable({ providedIn: 'root' })
export class MultiplayerService {
  private client: Client | null = null;
  private currentGameId: string | null = null;
  private roomSubscription: StompSubscription | null = null;

  readonly connected$ = new BehaviorSubject<boolean>(false);
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
  readonly roomParticipants$ = new BehaviorSubject<RoomParticipantDto[]>([]);

  connect(username?: string, reconnectToken?: string) {
    if (this.client && this.client.active) {
      return;
    }
    const wsUrl = this.resolveWsUrl();
    this.client = new Client({
      webSocketFactory: () => new SockJS(wsUrl),
      reconnectDelay: 2000,
      onConnect: () => {
        this.connected$.next(true);
        this.ready$.next(false);
        this.subscribeQueue();
        this.subscribeLobby();
        this.send('hello/auth', {
          username: username ?? null,
          reconnectToken: reconnectToken ?? null
        });
      },
      onStompError: () => {
        this.lastError$.next('stomp_error');
      },
      onWebSocketClose: () => {
        this.connected$.next(false);
        this.ready$.next(false);
        this.sessionUsername$.next(null);
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

  makeMove(gameId: string, move: { from: string; to: string; promotion?: string | null }) {
    this.send('makeMove', { gameId, move });
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

  kickPlayer(roomCode: string, username: string) {
    this.send('kickPlayer', { roomCode, username });
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
    this.currentGameId = null;
    this.gameState$.next(null);
    this.yourColor$.next(null);
    this.timeControl$.next(null);
    this.roomCode$.next(null);
    this.drawOffer$.next(false);
    this.activeRoomCode$.next(null);
    this.roomMessages$.next([]);
    this.roomInvite$.next(null);
    this.listRooms();
  }

  disconnect() {
    if (this.client) {
      this.client.deactivate();
      this.client = null;
    }
    this.connected$.next(false);
    this.ready$.next(false);
  }

  clearLastError() {
    this.lastError$.next(null);
  }

  private subscribeQueue() {
    if (!this.client) {
      return;
    }
    this.client.subscribe('/user/queue/game', (message) => this.handleMessage(message));
  }

  private subscribeGameTopic(gameId: string) {
    if (!this.client) {
      return;
    }
    this.client.subscribe(`/topic/game/${gameId}`, (message) => this.handleMessage(message));
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
        }
        this.ready$.next(true);
        break;
      case 'roomCreateFailed':
        this.lastError$.next(String(event.payload ?? 'room_create_failed'));
        break;
      case 'matchmakingFailed':
        this.lastError$.next(String(event.payload ?? 'matchmaking_failed'));
        break;
      case 'publicRooms':
        this.publicRooms$.next((event.payload as PublicRoomDto[]) ?? []);
        break;
      case 'roomInviteCreated':
        this.roomInvite$.next(event.payload as RoomInviteDto);
        break;
      case 'roomMessage':
        this.handleRoomMessage(event.payload as RoomMessageDto);
        break;
      case 'roomHistory':
        this.roomMessages$.next((event.payload as RoomMessageDto[]) ?? []);
        break;
      case 'roomParticipants': {
        const payload = event.payload as RoomParticipantsDto;
        if (payload && payload.participants) {
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
      case 'opponentReconnected':
        this.lastError$.next(event.type);
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
    this.currentGameId = event.gameId;
    this.subscribeGameTopic(event.gameId);
    this.roomCode$.next(null);
    this.reconnectToken$.next(event.reconnectToken);
    this.timeControl$.next(event.timeControlType ?? null);
    this.yourColor$.next(event.yourColor ?? null);
    this.drawOffer$.next(false);
    if (event.roomCode) {
      this.setActiveRoom(event.roomCode);
    }
    this.gameState$.next({
      gameId: event.gameId,
      fen: event.fen,
      sideToMove: event.sideToMove,
      yourColor: event.yourColor ?? null,
      roomCode: event.roomCode ?? null,
      result: 'ONGOING',
      endReason: 'NONE',
      moves: [],
      whiteTimeLeftMs: event.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs,
      lastMoveAt: event.lastMoveAt ?? null
    });
  }

  private handleMoveAccepted(event: MoveAcceptedEvent) {
    const current = this.gameState$.value;
    if (!current || current.gameId !== event.gameId) {
      return;
    }
    this.drawOffer$.next(false);
    this.gameState$.next({
      ...current,
      fen: event.fen,
      sideToMove: event.sideToMove,
      whiteTimeLeftMs: event.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs,
      lastMoveAt: event.lastMoveAt ?? current.lastMoveAt ?? null,
      moves: [...current.moves, event.move],
      analysis: event.analysis ?? current.analysis ?? null
    });
  }

  private handleMoveRejected(event: MoveRejectedEvent) {
    this.lastError$.next(event.reason);
    if (event.fen && event.sideToMove) {
      const current = this.gameState$.value;
      if (!current) {
        return;
      }
      this.gameState$.next({
        ...current,
        fen: event.fen,
        sideToMove: event.sideToMove,
        whiteTimeLeftMs: event.whiteTimeLeftMs ?? current.whiteTimeLeftMs,
        blackTimeLeftMs: event.blackTimeLeftMs ?? current.blackTimeLeftMs
      });
    }
  }

  private handleGameStateSync(event: GameStateSyncEvent) {
    if (event.state?.yourColor) {
      this.yourColor$.next(event.state.yourColor);
    }
    if (event.state?.roomCode) {
      this.setActiveRoom(event.state.roomCode);
    }
    this.gameState$.next(event.state);
  }

  private handleGameEnded(event: GameEndedEvent) {
    const current = this.gameState$.value;
    if (!current || current.gameId !== event.gameId) {
      return;
    }
    this.drawOffer$.next(false);
    this.gameState$.next({
      ...current,
      result: event.result,
      endReason: event.endReason,
      fen: event.fen ?? current.fen,
      sideToMove: event.sideToMove ?? current.sideToMove,
      whiteTimeLeftMs: event.whiteTimeLeftMs ?? current.whiteTimeLeftMs,
      blackTimeLeftMs: event.blackTimeLeftMs ?? current.blackTimeLeftMs
    });
  }

  private handleRoomMessage(message: RoomMessageDto) {
    const current = this.roomMessages$.value;
    this.roomMessages$.next([...current, message].slice(-100));
  }

  private send(destination: string, payload: unknown) {
    if (!this.client || !this.client.connected) {
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
    if (!this.client) {
      return;
    }
    this.client.subscribe('/topic/lobby', (message) => this.handleMessage(message));
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
    if (!this.client) {
      return;
    }
    if (this.roomSubscription) {
      this.roomSubscription.unsubscribe();
      this.roomSubscription = null;
    }
    this.roomSubscription = this.client.subscribe(`/topic/room/${roomCode}`, (message) => this.handleMessage(message));
  }
}
