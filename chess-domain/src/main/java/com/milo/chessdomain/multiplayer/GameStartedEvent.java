package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.TimeControlType;

import java.time.Instant;
import java.util.UUID;

public record GameStartedEvent(
        UUID gameId,
        Color yourColor,
        Color sideToMove,
        String fen,
        TimeControlType timeControlType,
        long whiteTimeLeftMs,
        long blackTimeLeftMs,
        Instant lastMoveAt,
        String reconnectToken,
        String roomCode,
        Long version
) {}
