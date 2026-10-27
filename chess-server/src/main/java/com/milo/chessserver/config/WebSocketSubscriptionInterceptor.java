package com.milo.chessserver.config;

import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.multiplayer.RoomService;
import com.milo.chessserver.multiplayer.SessionService;
import com.milo.chessserver.user.UserEntity;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class WebSocketSubscriptionInterceptor implements ChannelInterceptor {
    private final SessionService sessionService;
    private final GamePlayerRepository playerRepository;
    private final RoomService roomService;
    private final Map<String, String> principalBySessionId = new ConcurrentHashMap<>();

    public WebSocketSubscriptionInterceptor(SessionService sessionService,
                                            GamePlayerRepository playerRepository,
                                            RoomService roomService) {
        this.sessionService = sessionService;
        this.playerRepository = playerRepository;
        this.roomService = roomService;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);
        String destination = accessor.getDestination();
        String sessionId = accessor.getSessionId();
        if (accessor.getCommand() == StompCommand.CONNECT && sessionId != null && accessor.getUser() != null) {
            principalBySessionId.put(sessionId, accessor.getUser().getName());
        }
        if (accessor.getCommand() == StompCommand.SEND) {
            return destination != null && destination.startsWith("/app/") ? message : null;
        }
        if (accessor.getCommand() == StompCommand.SUBSCRIBE) return authorizeSubscription(message, accessor, destination);
        if (accessor.getMessageType() == SimpMessageType.MESSAGE) return authorizeOutbound(message, accessor, destination);
        return message;
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        if (event.getSessionId() != null) {
            principalBySessionId.remove(event.getSessionId());
        }
    }

    private Message<?> authorizeSubscription(Message<?> message, StompHeaderAccessor accessor, String destination) {
        if ("/topic/lobby".equals(destination)
                || destination != null && destination.startsWith("/user/queue/")) return message;
        UserEntity user = currentUser(accessor.getUser(), accessor.getSessionId());
        if (user == null || destination == null) return null;

        String roomPrefix = "/topic/room/";
        if (destination.startsWith(roomPrefix) && destination.length() > roomPrefix.length()
                && !destination.substring(roomPrefix.length()).contains("/")) {
            return roomService.isActiveRoomParticipant(user.getId(), destination.substring(roomPrefix.length()))
                    ? message : null;
        }

        String gamePrefix = "/topic/game/";
        if (destination.startsWith(gamePrefix) && destination.length() > gamePrefix.length()
                && !destination.substring(gamePrefix.length()).contains("/")) {
            try {
                UUID gameId = UUID.fromString(destination.substring(gamePrefix.length()));
                boolean player = playerRepository.findByGameIdAndUserId(gameId, user.getId()) != null;
                return player || roomService.isActiveParticipantInGame(user.getId(), gameId) ? message : null;
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        return null;
    }

    private Message<?> authorizeOutbound(Message<?> message, StompHeaderAccessor accessor, String destination) {
        if (destination == null || "/topic/lobby".equals(destination)
                || destination.startsWith("/queue/")) return message;
        UserEntity user = currentUser(accessor.getUser(), accessor.getSessionId());
        if (user == null) return null;

        String roomPrefix = "/topic/room/";
        if (destination.startsWith(roomPrefix) && destination.length() > roomPrefix.length()
                && !destination.substring(roomPrefix.length()).contains("/")) {
            return roomService.isActiveRoomParticipant(user.getId(), destination.substring(roomPrefix.length()))
                    ? message : null;
        }
        String gamePrefix = "/topic/game/";
        if (destination.startsWith(gamePrefix) && destination.length() > gamePrefix.length()
                && !destination.substring(gamePrefix.length()).contains("/")) {
            try {
                UUID gameId = UUID.fromString(destination.substring(gamePrefix.length()));
                boolean player = playerRepository.findByGameIdAndUserId(gameId, user.getId()) != null;
                return player || roomService.isActiveParticipantInGame(user.getId(), gameId) ? message : null;
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        return null;
    }

    private UserEntity currentUser(Principal principal, String sessionId) {
        String principalName = principal != null ? principal.getName()
                : sessionId != null ? principalBySessionId.get(sessionId) : null;
        return principalName == null ? null : sessionService.getUser(principalName);
    }
}
