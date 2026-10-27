package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.game.EngineMoveResponseDto;
import com.milo.chessdomain.game.MoveDto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record GameStateSyncDto(
        UUID gameId,
        String fen,
        Color sideToMove,
        Color yourColor,
        String roomCode,
        TimeControlType timeControlType,
        GameResult result,
        GameEndReason endReason,
        List<MoveDto> moves,
        long whiteTimeLeftMs,
        long blackTimeLeftMs,
        Instant lastMoveAt,
        EngineMoveResponseDto analysis,
        Long version
) {}
