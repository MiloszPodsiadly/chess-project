package com.milo.chessserver.multiplayer;

import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@EnableScheduling
public class ClockTimeoutScheduler {

    private final MultiplayerService multiplayerService;

    public ClockTimeoutScheduler(MultiplayerService multiplayerService) {
        this.multiplayerService = multiplayerService;
    }

    @Scheduled(fixedDelayString = "${chess.multiplayer.clock-timeout-check-ms:1000}")
    public void checkClockTimeouts() {
        multiplayerService.handleClockTimeouts();
    }
}
