package com.milo.chessserver.game;

import com.github.bhlangonijr.chesslib.Board;
import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.Side;
import com.github.bhlangonijr.chesslib.Square;
import com.github.bhlangonijr.chesslib.move.Move;
import com.github.bhlangonijr.chesslib.move.MoveGenerator;
import com.github.bhlangonijr.chesslib.move.MoveGeneratorException;
import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.game.MoveDto;
import org.springframework.stereotype.Service;

@Service
public class MoveValidationService {

    public MoveValidationResult validateAndApply(String fen, MoveDto moveDto) {
        return validateAndApply(fen, moveDto, java.util.List.of(fen));
    }

    public MoveValidationResult validateAndApply(String fen, MoveDto moveDto, java.util.List<String> previousFens) {
        Board board = new Board();
        try {
            board.loadFromFen(fen);
        } catch (Exception ex) {
            return new MoveValidationResult(false, fen, Color.WHITE, GameResult.ONGOING, GameEndReason.NONE);
        }
        Color currentSide = mapSide(board.getSideToMove());

        Move move = toMove(board, moveDto);
        if (move == null) {
            return new MoveValidationResult(false, fen, currentSide, GameResult.ONGOING, GameEndReason.NONE);
        }
        Move legalMove = resolveLegalMove(board, move);
        if (legalMove == null) {
            return new MoveValidationResult(false, fen, currentSide, GameResult.ONGOING, GameEndReason.NONE);
        }

        board.doMove(legalMove);

        GameResult result = GameResult.ONGOING;
        GameEndReason endReason = GameEndReason.NONE;

        if (board.isMated()) {
            result = board.getSideToMove() == Side.WHITE ? GameResult.BLACK_WIN : GameResult.WHITE_WIN;
            endReason = GameEndReason.CHECKMATE;
        } else if (board.isStaleMate()) {
            result = GameResult.DRAW;
            endReason = GameEndReason.STALEMATE;
        } else if (board.isInsufficientMaterial()) {
            result = GameResult.DRAW;
            endReason = GameEndReason.INSUFFICIENT_MATERIAL;
        } else if (isThreefoldRepetition(previousFens, board.getFen())) {
            result = GameResult.DRAW;
            endReason = GameEndReason.THREEFOLD_REPETITION;
        } else if (board.isRepetition()) {
            result = GameResult.DRAW;
            endReason = GameEndReason.THREEFOLD_REPETITION;
        } else if (board.getHalfMoveCounter() != null && board.getHalfMoveCounter() >= 100) {
            result = GameResult.DRAW;
            endReason = GameEndReason.FIFTY_MOVE_RULE;
        }

        return new MoveValidationResult(true, board.getFen(), mapSide(board.getSideToMove()), result, endReason);
    }

    private Move toMove(Board board, MoveDto moveDto) {
        if (moveDto == null) {
            return null;
        }
        Square from = Square.fromValue(moveDto.from().toUpperCase());
        Square to = Square.fromValue(moveDto.to().toUpperCase());
        if (from == null || to == null) {
            return null;
        }
        if (moveDto.promotion() == null || moveDto.promotion().isBlank()) {
            return new Move(from, to);
        }
        Piece promotion = promotionPiece(board.getSideToMove(), moveDto.promotion().charAt(0));
        if (promotion == null) {
            return null;
        }
        return new Move(from, to, promotion);
    }

    private Piece promotionPiece(Side side, char promotion) {
        char lower = Character.toLowerCase(promotion);
        if (side == Side.WHITE) {
            return switch (lower) {
                case 'q' -> Piece.WHITE_QUEEN;
                case 'r' -> Piece.WHITE_ROOK;
                case 'b' -> Piece.WHITE_BISHOP;
                case 'n' -> Piece.WHITE_KNIGHT;
                default -> null;
            };
        }
        return switch (lower) {
            case 'q' -> Piece.BLACK_QUEEN;
            case 'r' -> Piece.BLACK_ROOK;
            case 'b' -> Piece.BLACK_BISHOP;
            case 'n' -> Piece.BLACK_KNIGHT;
            default -> null;
        };
    }

    private Color mapSide(Side side) {
        return side == Side.WHITE ? Color.WHITE : Color.BLACK;
    }

    private Move resolveLegalMove(Board board, Move candidate) {
        try {
            for (Move legal : MoveGenerator.generateLegalMoves(board)) {
                if (legal.equals(candidate)) {
                    return legal;
                }
            }
        } catch (MoveGeneratorException ex) {
            return null;
        }
        return null;
    }

    private boolean isThreefoldRepetition(java.util.List<String> previousFens, String newFen) {
        if (newFen == null || newFen.isBlank()) {
            return false;
        }
        String target = repetitionKey(newFen);
        int count = 1;
        if (previousFens != null) {
            for (String fen : previousFens) {
                if (fen == null || fen.isBlank()) {
                    continue;
                }
                if (repetitionKey(fen).equals(target)) {
                    count++;
                }
            }
        }
        return count >= 3;
    }

    private String repetitionKey(String fen) {
        String[] parts = fen.trim().split("\\s+");
        if (parts.length >= 4) {
            return parts[0] + " " + parts[1] + " " + parts[2] + " " + parts[3];
        }
        return fen.trim();
    }
}
