package com.milo.chessdomain.game;

import com.milo.chessdomain.Color;

public record AnalysisRequestDto(
        String fen,
        Color sideToMove,
        int engineElo,
        Integer maxLines,
        Integer depth,
        Long timeMillis
) {}
