package com.milo.chessdomain.game;

import com.milo.chessdomain.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record GameStateDto(
        UUID gameId,
        String fen,
        Color sideToMove,
        GameResult result,
        GameEndReason endReason,
        List<MoveDto> moves,
        EvaluationDto evaluation,
        EngineMoveResponseDto analysis,
        Instant createdAt,
        Instant lastMoveAt,
        GameTurnState turnState,
        Long version,
        String engineError,
        String engineMode,
        String enginePreset,
        Integer engineElo
) {
    public GameStateDto(UUID gameId, String fen, Color sideToMove, GameResult result,
                        GameEndReason endReason, List<MoveDto> moves, EvaluationDto evaluation,
                        EngineMoveResponseDto analysis, Instant createdAt, Instant lastMoveAt) {
        this(gameId, fen, sideToMove, result, endReason, moves, evaluation, analysis,
                createdAt, lastMoveAt, null, null, null, null, null, null);
    }
}
