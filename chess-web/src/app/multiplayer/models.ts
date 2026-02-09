export type Color = 'WHITE' | 'BLACK';

export type TimeControlType = 'UNTIMED' | 'BULLET' | 'BLITZ' | 'RAPID' | 'CLASSICAL';

export interface EvaluationDto {
  type: 'CP' | 'MATE';
  value: number;
  side: Color;
}

export interface AnalysisLineDto {
  move: MoveDto;
  evaluation: EvaluationDto | null;
  principalVariation: MoveDto[];
  san?: string | null;
  principalVariationSan?: string[] | null;
}

export interface EngineMoveResponseDto {
  bestMove: MoveDto | null;
  principalVariation: MoveDto[];
  evaluation: EvaluationDto | null;
  depth: number;
  nodes: number;
  timeMillis: number;
  topLines: AnalysisLineDto[];
}

export interface MoveDto {
  from: string;
  to: string;
  promotion?: string | null;
  playerColor: Color;
}

export interface GameStateSyncDto {
  gameId: string;
  fen: string;
  sideToMove: Color;
  yourColor?: Color | null;
  roomCode?: string | null;
  result: 'ONGOING' | 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW';
  endReason:
    | 'NONE'
    | 'CHECKMATE'
    | 'STALEMATE'
    | 'RESIGNATION'
    | 'TIME_OUT'
    | 'AGREED_DRAW'
    | 'THREEFOLD_REPETITION'
    | 'FIFTY_MOVE_RULE'
    | 'INSUFFICIENT_MATERIAL';
  moves: MoveDto[];
  whiteTimeLeftMs: number;
  blackTimeLeftMs: number;
  lastMoveAt?: string | null;
  analysis?: EngineMoveResponseDto | null;
}

export interface WsEvent<T = unknown> {
  type: string;
  payload: T;
}

export interface HelloAck {
  username?: string | null;
}

export interface PublicRoomDto {
  roomCode: string;
  name?: string | null;
  hostUsername?: string | null;
  timeControlType: TimeControlType;
  createdAt: string;
  status: 'OPEN' | 'IN_GAME' | 'CLOSED';
  currentPlayers: number;
}

export interface RoomInviteDto {
  roomCode: string;
  token: string;
  expiresAt?: string | null;
  maxUses: number;
  uses: number;
}

export interface RoomMessageDto {
  roomCode: string;
  username: string;
  message: string;
  createdAt: string;
}

export interface RoomParticipantDto {
  username?: string | null;
  role?: string | null;
  status?: string | null;
}

export interface RoomParticipantsDto {
  roomCode: string;
  participants: RoomParticipantDto[];
}

export interface GameStartedEvent {
  gameId: string;
  yourColor: Color;
  sideToMove: Color;
  fen: string;
  timeControlType: TimeControlType;
  whiteTimeLeftMs: number;
  blackTimeLeftMs: number;
  lastMoveAt?: string | null;
  reconnectToken: string;
  roomCode?: string | null;
}

export interface MoveAcceptedEvent {
  gameId: string;
  move: MoveDto;
  fen: string;
  sideToMove: Color;
  whiteTimeLeftMs: number;
  blackTimeLeftMs: number;
  lastMoveAt?: string | null;
  analysis?: EngineMoveResponseDto | null;
}

export interface MoveRejectedEvent {
  gameId: string;
  reason: string;
  fen?: string;
  sideToMove?: Color;
  whiteTimeLeftMs?: number;
  blackTimeLeftMs?: number;
}

export interface GameStateSyncEvent {
  state: GameStateSyncDto;
}

export interface GameEndedEvent {
  gameId: string;
  result: GameStateSyncDto['result'];
  endReason: GameStateSyncDto['endReason'];
  fen?: string;
  sideToMove?: Color;
  whiteTimeLeftMs?: number;
  blackTimeLeftMs?: number;
}
