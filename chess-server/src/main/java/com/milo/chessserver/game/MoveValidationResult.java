package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;

public record MoveValidationResult(
        boolean legal,
        String fenAfterMove,
        Color sideToMove,
        GameResult result,
        GameEndReason endReason
) {}
