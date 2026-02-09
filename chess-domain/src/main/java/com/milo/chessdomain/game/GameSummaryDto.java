package com.milo.chessdomain.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameType;
import com.milo.chessdomain.TimeControlType;

import java.time.Instant;
import java.util.UUID;

public record GameSummaryDto(
        UUID gameId,
        GameType gameType,
        String opponentName,
        boolean opponentIsEngine,
        Color playerColor,
        GameResult result,
        TimeControlType timeControlType,
        int playerRatingBefore,
        int playerRatingAfter,
        int totalMoves,
        String lastMoveUci,
        String lastMoveSan,
        Instant startedAt,
        Instant finishedAt
) {}
