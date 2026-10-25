import { Chess } from 'chess.js';
import { ServerEngineGame } from '../bot/engine-game-api.service';

export type GameColor = 'WHITE' | 'BLACK';
export type GameResult = 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW';
export type EndReason = 'CHECKMATE' | 'STALEMATE' | 'THREEFOLD_REPETITION'
  | 'FIFTY_MOVE_RULE' | 'INSUFFICIENT_MATERIAL' | 'RESIGNATION'
  | 'TIME_OUT' | 'AGREED_DRAW' | 'UNKNOWN';

export interface GameOutcome {
  status: 'FINISHED';
  result: GameResult;
  winnerColor: GameColor | null;
  perspective: 'WIN' | 'LOSS' | 'DRAW' | 'NEUTRAL';
  endReason: EndReason;
  finalFen: string;
  moveCount: number;
  gameId: string;
}

function finish(result: GameResult, endReason: EndReason, playerColor: GameColor | null,
                finalFen: string, moveCount: number, gameId: string): GameOutcome {
  const winnerColor = result === 'DRAW' ? null : result === 'WHITE_WIN' ? 'WHITE' : 'BLACK';
  return { status: 'FINISHED', result, winnerColor,
    perspective: winnerColor === null ? 'DRAW' : playerColor === null ? 'NEUTRAL'
      : winnerColor === playerColor ? 'WIN' : 'LOSS',
    endReason, finalFen, moveCount, gameId };
}

export function localOutcome(chess: Chess, playerColor: GameColor, gameId: string,
                             resigned = false): GameOutcome | null {
  if (resigned) {
    return finish(playerColor === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN', 'RESIGNATION',
      playerColor, chess.fen(), chess.history().length, gameId);
  }
  if (chess.isCheckmate()) {
    const result = chess.turn() === 'w' ? 'BLACK_WIN' : 'WHITE_WIN';
    return finish(result, 'CHECKMATE', playerColor, chess.fen(), chess.history().length, gameId);
  }
  if (!chess.isGameOver()) return null;
  const reason: EndReason = chess.isStalemate() ? 'STALEMATE'
    : chess.isThreefoldRepetition() ? 'THREEFOLD_REPETITION'
    : chess.isDrawByFiftyMoves() ? 'FIFTY_MOVE_RULE'
    : chess.isInsufficientMaterial() ? 'INSUFFICIENT_MATERIAL' : 'UNKNOWN';
  return finish('DRAW', reason, playerColor, chess.fen(), chess.history().length, gameId);
}

export function serverOutcome(game: ServerEngineGame): GameOutcome | null {
  if (game.result === 'ONGOING') return null;
  const knownReasons: EndReason[] = ['CHECKMATE', 'STALEMATE', 'THREEFOLD_REPETITION',
    'FIFTY_MOVE_RULE', 'INSUFFICIENT_MATERIAL', 'RESIGNATION', 'TIME_OUT', 'AGREED_DRAW'];
  const reason = knownReasons.includes(game.endReason as EndReason)
    ? game.endReason as EndReason : 'UNKNOWN';
  return finish(game.result, reason, game.playerColor, game.fen, game.moves.length, game.gameId);
}
