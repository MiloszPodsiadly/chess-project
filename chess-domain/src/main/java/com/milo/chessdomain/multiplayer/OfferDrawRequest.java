package com.milo.chessdomain.multiplayer;

import java.util.UUID;

public record OfferDrawRequest(
        UUID gameId,
        String fen,
        com.milo.chessdomain.Color sideToMove,
        long whiteTimeLeftMs,
        long blackTimeLeftMs
) {}
