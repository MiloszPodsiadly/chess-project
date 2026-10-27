package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;

import java.util.UUID;

public record GameEndedEvent(
        UUID gameId,
        GameResult result,
        GameEndReason endReason,
        String fen,
        Color sideToMove,
        long whiteTimeLeftMs,
        long blackTimeLeftMs,
        Long version,
        java.util.List<com.milo.chessdomain.game.MoveDto> moves
) {}
