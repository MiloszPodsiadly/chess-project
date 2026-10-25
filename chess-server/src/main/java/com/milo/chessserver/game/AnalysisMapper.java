package com.milo.chessserver.game;

import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.Square;
import com.github.bhlangonijr.chesslib.move.Move;
import com.github.bhlangonijr.chesslib.move.MoveConversionException;
import com.github.bhlangonijr.chesslib.move.MoveList;
import com.milo.chessdomain.game.AnalysisLineDto;
import com.milo.chessdomain.game.EngineMoveResponseDto;
import com.milo.chessdomain.game.EvaluationDto;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.bot.CandidateMove;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.EvalScore;

import java.util.ArrayList;
import java.util.List;

public final class AnalysisMapper {

    private AnalysisMapper() {
    }

    public static EngineMoveResponseDto toResponse(String fen, EngineResult result) {
        if (result == null) {
            return new EngineMoveResponseDto(null, List.of(), null, 0, 0L, 0L, List.of());
        }
        EvaluationDto evaluation = toEvaluation(result.score());
        List<AnalysisLineDto> lines = toLines(fen, result.topMoves(), 5);
        return new EngineMoveResponseDto(
                result.bestMove(),
                result.principalVariation(),
                evaluation,
                result.depthReached(),
                result.nodes(),
                result.timeMillis(),
                lines
        );
    }

    public static EngineMoveResponseDto toResponse(String fen, EngineResult result, int maxLines) {
        if (result == null) {
            return new EngineMoveResponseDto(null, List.of(), null, 0, 0L, 0L, List.of());
        }
        EvaluationDto evaluation = toEvaluation(result.score());
        List<AnalysisLineDto> lines = toLines(fen, result.topMoves(), maxLines);
        return new EngineMoveResponseDto(
                result.bestMove(),
                result.principalVariation(),
                evaluation,
                result.depthReached(),
                result.nodes(),
                result.timeMillis(),
                lines
        );
    }

    private static EvaluationDto toEvaluation(EvalScore score) {
        if (score == null) {
            return null;
        }
        return new EvaluationDto(score.type(), score.value(), score.side());
    }

    private static List<AnalysisLineDto> toLines(String fen, List<CandidateMove> candidates, int maxLines) {
        if (candidates == null || candidates.isEmpty()) {
            return List.of();
        }
        int limit = Math.max(1, maxLines);
        List<AnalysisLineDto> lines = new ArrayList<>();
        candidates.stream()
                .limit(limit)
                .forEach(c -> {
                    List<String> pvSan = toSanList(fen, c.principalVariation());
                    String san = pvSan.isEmpty() ? null : pvSan.get(0);
                    lines.add(new AnalysisLineDto(
                            c.move(),
                            toEvaluation(c.score()),
                            c.principalVariation(),
                            san,
                            pvSan
                    ));
                });
        return lines;
    }

    private static List<String> toSanList(String fen, List<MoveDto> moves) {
        if (fen == null || moves == null || moves.isEmpty()) {
            return List.of();
        }
        MoveList moveList = new MoveList(fen);
        try {
            for (MoveDto dto : moves) {
                Move move = toMove(dto);
                if (move == null) {
                    break;
                }
                moveList.add(move);
            }
            String[] sanArray = moveList.toSanArray();
            if (sanArray == null || sanArray.length == 0) {
                return List.of();
            }
            return java.util.Arrays.asList(sanArray);
        } catch (MoveConversionException | IllegalArgumentException | NullPointerException ex) {
            return List.of();
        }
    }

    private static Move toMove(MoveDto moveDto) {
        if (moveDto == null) {
            return null;
        }
        Square from = Square.fromValue(moveDto.from().toUpperCase(java.util.Locale.ROOT));
        Square to = Square.fromValue(moveDto.to().toUpperCase(java.util.Locale.ROOT));
        if (from == null || to == null) {
            return null;
        }
        if (moveDto.promotion() == null || moveDto.promotion().isBlank()) {
            return new Move(from, to);
        }
        boolean white = moveDto.playerColor() == com.milo.chessdomain.Color.WHITE;
        Piece promotion = switch (Character.toLowerCase(moveDto.promotion().charAt(0))) {
            case 'q' -> white ? Piece.WHITE_QUEEN : Piece.BLACK_QUEEN;
            case 'r' -> white ? Piece.WHITE_ROOK : Piece.BLACK_ROOK;
            case 'b' -> white ? Piece.WHITE_BISHOP : Piece.BLACK_BISHOP;
            case 'n' -> white ? Piece.WHITE_KNIGHT : Piece.BLACK_KNIGHT;
            default -> Piece.NONE;
        };
        return new Move(from, to, promotion);
    }
}
