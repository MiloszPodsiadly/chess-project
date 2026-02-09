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
        Instant lastMoveAt
) {}
