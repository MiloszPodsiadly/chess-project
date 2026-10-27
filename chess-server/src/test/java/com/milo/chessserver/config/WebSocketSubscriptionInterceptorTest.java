package com.milo.chessserver.config;

import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.multiplayer.RoomService;
import com.milo.chessserver.multiplayer.SessionService;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.game.GamePlayerEntity;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;

import java.security.Principal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.*;

class WebSocketSubscriptionInterceptorTest {
    @Test
    void clientCannotPublishDirectlyToBrokerTopics() {
        WebSocketSubscriptionInterceptor interceptor = new WebSocketSubscriptionInterceptor(
                mock(SessionService.class), mock(GamePlayerRepository.class), mock(RoomService.class));
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SEND);
        accessor.setDestination("/topic/game/4d56b5d7-6bc3-4290-9ee9-30b9a0f263ed");
        accessor.setLeaveMutable(true);
        Message<byte[]> message = MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());

        assertNull(interceptor.preSend(message, mock(MessageChannel.class)));
    }

    @Test
    void outboundGameTopicUsesTheCurrentStompSessionWhenBrokerOmitsThePrincipal() {
        SessionService sessions = mock(SessionService.class);
        GamePlayerRepository players = mock(GamePlayerRepository.class);
        UserEntity user = mock(UserEntity.class);
        when(user.getId()).thenReturn(42L);
        WebSocketSubscriptionInterceptor interceptor = new WebSocketSubscriptionInterceptor(
                sessions, players, mock(RoomService.class));
        String sessionId = "stomp-session";
        String principalName = "socket-principal";
        UUID gameId = UUID.randomUUID();
        when(sessions.getUser(principalName)).thenReturn(user);
        when(players.findByGameIdAndUserId(gameId, 42L)).thenReturn(mock(GamePlayerEntity.class));

        StompHeaderAccessor connect = StompHeaderAccessor.create(StompCommand.CONNECT);
        connect.setSessionId(sessionId);
        connect.setUser((Principal) () -> principalName);
        connect.setLeaveMutable(true);
        Message<byte[]> connectMessage = MessageBuilder.createMessage(new byte[0], connect.getMessageHeaders());
        interceptor.preSend(connectMessage, mock(MessageChannel.class));

        SimpMessageHeaderAccessor outbound = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        outbound.setSessionId(sessionId);
        outbound.setDestination("/topic/game/" + gameId);
        outbound.setLeaveMutable(true);
        Message<byte[]> event = MessageBuilder.createMessage(new byte[0], outbound.getMessageHeaders());

        assertSame(event, interceptor.preSend(event, mock(MessageChannel.class)));
    }
}
