import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { MultiplayerReplayState } from './multiplayer-replay-state';

function replay(sanMoves: string[]) {
  const chess = new Chess();
  const moves = sanMoves.map(san => {
    const move = chess.move(san);
    return { from: move.from, to: move.to, promotion: move.promotion };
  });
  return new MultiplayerReplayState(chess.fen(), moves, chess.turn());
}

describe('MultiplayerReplayState', () => {
  it('starts at the initial position and safely clamps navigation boundaries', () => {
    const initial = new Chess();
    const state = new MultiplayerReplayState(initial.fen(), [], 'w');

    expect(state.positionIndex).toBe(0);
    expect(state.activeMoveIndex).toBe(-1);
    expect(state.currentPosition.fen).toBe(initial.fen());
    state.previous();
    state.seek(20);
    expect(state.positionIndex).toBe(0);
  });

  it('replays each move without changing the final authoritative position', () => {
    const state = replay(['e4', 'e5', 'Nf3']);
    const finalFen = state.currentPosition.fen;

    expect(state.moves.map(move => move.san)).toEqual(['e4', 'e5', 'Nf3']);
    state.first();
    expect(state.currentPosition.fen).toBe(new Chess().fen());
    state.next();
    expect(state.currentPosition.lastMove?.san).toBe('e4');
    expect(state.activeMoveIndex).toBe(0);
    state.last();
    expect(state.currentPosition.fen).toBe(finalFen);
    expect(state.currentPosition.lastMove?.san).toBe('Nf3');
  });

  it('supports castling, en passant, and promotion', () => {
    const castling = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']);
    expect(castling.moves.at(-1)?.san).toBe('O-O');
    expect(castling.currentPosition.fen.split(' ')[0]).toContain('RNBQ1RK1');

    const enPassant = replay(['e4', 'a6', 'e5', 'd5', 'exd6']);
    expect(enPassant.moves.at(-1)?.san).toBe('exd6');
    expect(enPassant.currentPosition.fen.split(' ')[0]).toContain('p2P4');

    const promotionStart = '7k/P7/8/8/8/8/8/7K w - - 0 1';
    const promotionChess = new Chess(promotionStart);
    const promotionMove = promotionChess.move({ from: 'a7', to: 'a8', promotion: 'q' });
    const promotion = new MultiplayerReplayState(promotionChess.fen(), [{
      from: promotionMove.from, to: promotionMove.to, promotion: promotionMove.promotion
    }], promotionChess.turn(), promotionStart);
    expect(promotion.moves.at(-1)?.san).toBe('a8=Q+');
  });

  it('marks checkmate and rejects history that does not match the final server state', () => {
    const mate = replay(['f3', 'e5', 'g4', 'Qh4#']);
    expect(mate.currentPosition.status).toBe('CHECKMATE');
    expect(mate.currentPosition.checkedKingSquare).toBe('e1');

    const wrongFinal = new Chess();
    expect(() => new MultiplayerReplayState(wrongFinal.fen(), [
      { from: 'e2', to: 'e4' }
    ], 'b')).toThrow('Game history does not match the server position');
  });

  it('accepts only the current en-passant square from the final move', () => {
    const onePush = new Chess();
    onePush.move('e4');
    const oneMove = onePush.history({ verbose: true }).map(move => ({
      from: move.from, to: move.to, promotion: move.promotion
    }));
    expect(() => new MultiplayerReplayState(
      onePush.fen({ forceEnpassantSquare: true }), oneMove, onePush.turn())).not.toThrow();

    const earlierEnPassant = new Chess();
    for (const san of ['e4', 'a6', 'e5', 'd5', 'exd6', 'a5']) earlierEnPassant.move(san);
    const moves = earlierEnPassant.history({ verbose: true }).map(move => ({
      from: move.from, to: move.to, promotion: move.promotion
    }));
    const corruptedFen = earlierEnPassant.fen().split(' ');
    corruptedFen[3] = 'd6';

    expect(() => new MultiplayerReplayState(corruptedFen.join(' '), moves,
      earlierEnPassant.turn())).toThrow('Game history does not match the server position');
  });
});
