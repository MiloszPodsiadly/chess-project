package com.milo.chessserver.multiplayer;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@EnableScheduling
public class MatchmakingCleanupScheduler {

    private final MatchmakingService matchmakingService;
    private final MultiplayerService multiplayerService;
    private final long roomTtlMinutes;

    public MatchmakingCleanupScheduler(MatchmakingService matchmakingService,
                                       MultiplayerService multiplayerService,
                                       @Value("${chess.matchmaking.room-ttl-minutes:10}") long roomTtlMinutes) {
        this.matchmakingService = matchmakingService;
        this.multiplayerService = multiplayerService;
        this.roomTtlMinutes = roomTtlMinutes;
    }

    @Scheduled(fixedDelayString = "${chess.matchmaking.cleanup-ms:60000}")
    public void cleanup() {
        matchmakingService.cleanup(Duration.ofMinutes(5));
        multiplayerService.cleanupOldRooms(Duration.ofMinutes(roomTtlMinutes));
    }
}
