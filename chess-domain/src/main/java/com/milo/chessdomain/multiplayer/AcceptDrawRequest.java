package com.milo.chessdomain.multiplayer;

import java.util.UUID;

public record AcceptDrawRequest(
        UUID gameId,
        String fen,
        com.milo.chessdomain.Color sideToMove,
        long whiteTimeLeftMs,
        long blackTimeLeftMs
) {}
