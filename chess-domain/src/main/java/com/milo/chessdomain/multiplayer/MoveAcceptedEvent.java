package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.EngineMoveResponseDto;
import com.milo.chessdomain.game.MoveDto;

import java.time.Instant;
import java.util.UUID;

public record MoveAcceptedEvent(
        UUID gameId,
        MoveDto move,
        String fen,
        Color sideToMove,
        long whiteTimeLeftMs,
        long blackTimeLeftMs,
        Instant lastMoveAt,
        EngineMoveResponseDto analysis
) {}
