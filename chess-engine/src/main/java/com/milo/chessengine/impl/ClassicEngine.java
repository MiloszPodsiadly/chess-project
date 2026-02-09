package com.milo.chessengine.impl;

import com.github.bhlangonijr.chesslib.Board;
import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.Square;
import com.github.bhlangonijr.chesslib.move.Move;
import com.github.bhlangonijr.chesslib.move.MoveGenerator;
import com.github.bhlangonijr.chesslib.move.MoveGeneratorException;
import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.config.EloProfile;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.EvalScore;
import com.milo.chessengine.core.Position;
import com.milo.chessengine.bot.BotMoveStrategy;
import com.milo.chessengine.bot.CandidateMove;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ClassicEngine implements ChessEngine {

    @Override
    public EngineResult findBestMove(Position position, EngineConfig config) {
        Instant started = Instant.now();
        Board board = new Board();
        try {
            board.loadFromFen(position.fen());
        } catch (Exception ex) {
            EvalScore score = EvalScore.cp(0, position.sideToMove());
            return new EngineResult(null, List.of(), score, 0, 0L, 0L, List.of());
        }
        Color sideToMove = position.sideToMove();

        List<Move> legalMoves;
        try {
            legalMoves = MoveGenerator.generateLegalMoves(board);
        } catch (MoveGeneratorException ex) {
            EvalScore score = EvalScore.cp(0, sideToMove);
            return new EngineResult(null, List.of(), score, 0, 0L, 0L, List.of());
        }
        if (legalMoves.isEmpty()) {
            EvalScore score = EvalScore.cp(0, sideToMove);
            return new EngineResult(null, List.of(), score, 0, 0L, 0L, List.of());
        }

        List<CandidateMove> candidates = new ArrayList<>();
        for (Move move : legalMoves) {
            board.doMove(move);
            int eval = evaluateMaterial(board, sideToMove);
            board.undoMove();

            MoveDto dto = toMoveDto(move, sideToMove);
            EvalScore score = EvalScore.cp(eval, sideToMove);
            candidates.add(new CandidateMove(dto, score, List.of(dto)));
        }

        EloProfile profile = EngineConfigMapper.forElo(config.engineElo());
        CandidateMove choice = BotMoveStrategy.chooseMove(candidates, profile);
        if (choice == null) {
            EvalScore score = EvalScore.cp(0, sideToMove);
            return new EngineResult(null, List.of(), score, 1, legalMoves.size(), Duration.between(started, Instant.now()).toMillis(), candidates);
        }

        long timeMs = Duration.between(started, Instant.now()).toMillis();
        return new EngineResult(
                choice.move(),
                choice.principalVariation(),
                choice.score(),
                1,
                legalMoves.size(),
                timeMs,
                candidates
        );
    }

    private int evaluateMaterial(Board board, Color perspective) {
        int score = 0;
        for (Square square : Square.values()) {
            if (square == Square.NONE) {
                continue;
            }
            Piece piece = board.getPiece(square);
            if (piece == Piece.NONE) {
                continue;
            }
            int value = switch (piece.getPieceType()) {
                case PAWN -> 100;
                case KNIGHT -> 320;
                case BISHOP -> 330;
                case ROOK -> 500;
                case QUEEN -> 900;
                case KING -> 0;
                default -> 0;
            };
            score += piece.getPieceSide() == com.github.bhlangonijr.chesslib.Side.WHITE ? value : -value;
        }
        if (perspective == Color.BLACK) {
            score = -score;
        }
        return score;
    }

    private MoveDto toMoveDto(Move move, Color sideToMove) {
        String from = move.getFrom().value().toLowerCase(Locale.ROOT);
        String to = move.getTo().value().toLowerCase(Locale.ROOT);
        String promotion = null;
        if (move.getPromotion() != null && move.getPromotion() != Piece.NONE) {
            promotion = switch (move.getPromotion().getPieceType()) {
                case QUEEN -> "q";
                case ROOK -> "r";
                case BISHOP -> "b";
                case KNIGHT -> "n";
                case PAWN -> "p";
                case KING -> "k";
                default -> null;
            };
        }
        return new MoveDto(from, to, promotion, sideToMove);
    }
}
