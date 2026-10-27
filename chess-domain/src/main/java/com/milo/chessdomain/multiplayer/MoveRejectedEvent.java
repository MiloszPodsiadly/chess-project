package com.milo.chessdomain.multiplayer;

import java.util.UUID;

import com.milo.chessdomain.Color;

public record MoveRejectedEvent(
        UUID gameId,
        String reason,
        String fen,
        Color sideToMove,
        long whiteTimeLeftMs,
        long blackTimeLeftMs,
        Long version
) {}
