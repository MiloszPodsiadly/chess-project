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
    private final RoomService roomService;
    private final long roomTtlMinutes;

    public MatchmakingCleanupScheduler(MatchmakingService matchmakingService,
                                       RoomService roomService,
                                       @Value("${chess.matchmaking.room-ttl-minutes:10}") long roomTtlMinutes) {
        this.matchmakingService = matchmakingService;
        this.roomService = roomService;
        this.roomTtlMinutes = roomTtlMinutes;
    }

    @Scheduled(fixedDelayString = "${chess.matchmaking.cleanup-ms:60000}")
    public void cleanup() {
        matchmakingService.cleanup(Duration.ofMinutes(30), Duration.ofMinutes(5));
        roomService.cleanupOldRooms(Duration.ofMinutes(roomTtlMinutes));
    }
}
