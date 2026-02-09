package com.milo.chessserver.multiplayer;

import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
@EnableScheduling
public class ReconnectTimeoutScheduler {

    private final MultiplayerService multiplayerService;

    public ReconnectTimeoutScheduler(MultiplayerService multiplayerService) {
        this.multiplayerService = multiplayerService;
    }

    @Scheduled(fixedDelayString = "${chess.multiplayer.reconnect-timeout-check-ms:30000}")
    public void checkTimeouts() {
        long timeoutMs = multiplayerService.reconnectTimeoutMs();
        multiplayerService.handleReconnectTimeouts(Duration.ofMillis(timeoutMs));
    }
}
