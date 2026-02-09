package com.milo.chessserver.multiplayer;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Component
public class WebSocketEventListener {

    private final MultiplayerService multiplayerService;

    public WebSocketEventListener(MultiplayerService multiplayerService) {
        this.multiplayerService = multiplayerService;
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        String sessionKey = event.getUser() != null ? event.getUser().getName() : event.getSessionId();
        if (sessionKey != null) {
            multiplayerService.handleDisconnect(sessionKey);
        }
    }
}
