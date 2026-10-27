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
import org.springframework.messaging.support.ExecutorSubscribableChannel;

import java.security.Principal;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;
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

    @Test
    void formerRoomMemberCannotReceiveTopicClosureButReceivesPrivateQueueClosure() {
        SessionService sessions = mock(SessionService.class);
        RoomService rooms = mock(RoomService.class);
        UserEntity user = mock(UserEntity.class);
        when(user.getId()).thenReturn(42L);
        when(sessions.getUser("room-user")).thenReturn(user);
        when(rooms.isActiveRoomParticipant(42L, "SECRET")).thenReturn(false);
        WebSocketSubscriptionInterceptor interceptor = new WebSocketSubscriptionInterceptor(
                sessions, mock(GamePlayerRepository.class), rooms);
        String sessionId = "former-session";

        StompHeaderAccessor connect = StompHeaderAccessor.create(StompCommand.CONNECT);
        connect.setSessionId(sessionId);
        connect.setUser((Principal) () -> "room-user");
        connect.setLeaveMutable(true);
        interceptor.preSend(MessageBuilder.createMessage(new byte[0], connect.getMessageHeaders()),
                mock(MessageChannel.class));

        ExecutorSubscribableChannel outbound = new ExecutorSubscribableChannel();
        outbound.addInterceptor(interceptor);
        java.util.List<Message<?>> delivered = new java.util.ArrayList<>();
        outbound.subscribe(delivered::add);

        SimpMessageHeaderAccessor topicHeaders = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        topicHeaders.setSessionId(sessionId);
        topicHeaders.setDestination("/topic/room/SECRET");
        topicHeaders.setLeaveMutable(true);
        Message<byte[]> topicEvent = MessageBuilder.createMessage(new byte[0], topicHeaders.getMessageHeaders());
        assertFalse(outbound.send(topicEvent));
        assertTrue(delivered.isEmpty());

        SimpMessageHeaderAccessor queueHeaders = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        queueHeaders.setSessionId(sessionId);
        queueHeaders.setDestination("/queue/game-user" + sessionId);
        queueHeaders.setLeaveMutable(true);
        Message<byte[]> privateEvent = MessageBuilder.createMessage(new byte[0], queueHeaders.getMessageHeaders());

        assertTrue(outbound.send(privateEvent));
        assertEquals(1, delivered.size());
        assertSame(privateEvent, delivered.get(0));
        assertEquals("/queue/game-user" + sessionId,
                SimpMessageHeaderAccessor.getDestination(delivered.get(0).getHeaders()));
        verify(rooms).isActiveRoomParticipant(42L, "SECRET");
    }
}
