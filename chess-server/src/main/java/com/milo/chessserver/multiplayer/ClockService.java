package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessserver.game.GameEntity;

import java.time.Duration;
import java.time.Instant;

import org.springframework.stereotype.Service;

@Service
public class ClockService {

    public long initialTimeMs(TimeControlType type) {
        return switch (type) {
            case BULLET -> 60_000L;
            case BLITZ -> 300_000L;
            case RAPID -> 600_000L;
            case CLASSICAL -> 1_800_000L;
            case UNTIMED -> 0L;
        };
    }

    public void applyMove(GameEntity game, Color mover, Instant now) {
        if (game.getTimeControlType() == TimeControlType.UNTIMED) {
            game.setLastMoveAt(now);
            return;
        }
        Instant last = game.getLastMoveAt();
        if (last == null) {
            last = game.getStartedAt();
        }
        long elapsed = Math.max(0L, Duration.between(last, now).toMillis());
        if (mover == Color.WHITE) {
            long remaining = Math.max(0L, game.getWhiteTimeLeftMs() - elapsed);
            game.setWhiteTimeLeftMs(remaining);
        } else {
            long remaining = Math.max(0L, game.getBlackTimeLeftMs() - elapsed);
            game.setBlackTimeLeftMs(remaining);
        }
        game.setLastMoveAt(now);
    }

    public long remainingAfterTick(GameEntity game, Color mover, Instant now) {
        if (game.getTimeControlType() == TimeControlType.UNTIMED) {
            return Long.MAX_VALUE;
        }
        Instant last = game.getLastMoveAt();
        if (last == null) {
            last = game.getStartedAt();
        }
        long elapsed = Math.max(0L, Duration.between(last, now).toMillis());
        if (mover == Color.WHITE) {
            return Math.max(0L, game.getWhiteTimeLeftMs() - elapsed);
        }
        return Math.max(0L, game.getBlackTimeLeftMs() - elapsed);
    }
}
