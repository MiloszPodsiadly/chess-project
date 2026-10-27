package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.multiplayer.RoomClosureReason;
import com.milo.chessdomain.multiplayer.RoomLifecycleEvent;
import com.milo.chessdomain.multiplayer.RoomLifecycleEventType;
import com.milo.chessdomain.multiplayer.RoomStatus;
import com.milo.chessdomain.multiplayer.DeleteRoomRequest;
import com.milo.chessdomain.multiplayer.HelloAck;
import com.milo.chessdomain.multiplayer.HelloAuthRequest;
import com.milo.chessengine.ChessEngine;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameService;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MultiplayerRoomLifecycleTest {
    @Test
    void deleteNotifiesEveryFormerMemberThroughTheirPrivateQueue() {
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        SessionService sessions = mock(SessionService.class);
        RoomService rooms = mock(RoomService.class);
        UserEntity host = user(11L);
        RoomService.RoomLifecycleChange closed = new RoomService.RoomLifecycleChange(
                "ROOM01", RoomLifecycleEventType.ROOM_CLOSED, RoomStatus.CLOSED,
                RoomClosureReason.HOST_DELETED, null, List.of(11L, 22L), Instant.parse("2026-10-27T12:00:00Z"));
        MultiplayerService service = service(messaging, sessions, rooms);
        when(sessions.getUser("host-socket")).thenReturn(host);
        when(rooms.deleteRoom(host, "ROOM01")).thenReturn(closed);
        when(sessions.getSessionId(11L)).thenReturn("host-socket");
        when(sessions.getSessionId(22L)).thenReturn("guest-socket");

        service.deleteRoom("host-socket", new DeleteRoomRequest("ROOM01"));

        verify(messaging).convertAndSendToUser(eq("host-socket"), eq("/queue/game"), any(WsEvent.class));
        verify(messaging).convertAndSendToUser(eq("guest-socket"), eq("/queue/game"), any(WsEvent.class));
        verify(messaging, never()).convertAndSend(eq("/topic/room/ROOM01"), any(WsEvent.class));
        verify(messaging).convertAndSend(eq("/topic/lobby"), any(WsEvent.class));

        org.mockito.ArgumentCaptor<WsEvent> event = org.mockito.ArgumentCaptor.forClass(WsEvent.class);
        verify(messaging).convertAndSendToUser(eq("guest-socket"), eq("/queue/game"), event.capture());
        assertEquals("roomClosed", event.getValue().type());
        assertEquals("ROOM01", ((RoomLifecycleEvent) event.getValue().payload()).roomCode());
        assertEquals(RoomClosureReason.HOST_DELETED,
                ((RoomLifecycleEvent) event.getValue().payload()).closeReason());
    }

    @Test
    void duplicateDeleteDoesNotSendAnotherClosureNotification() {
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        SessionService sessions = mock(SessionService.class);
        RoomService rooms = mock(RoomService.class);
        UserEntity host = user(11L);
        MultiplayerService service = service(messaging, sessions, rooms);
        when(sessions.getUser("host-socket")).thenReturn(host);
        when(rooms.deleteRoom(host, "ROOM01")).thenReturn(null);

        service.deleteRoom("host-socket", new DeleteRoomRequest("ROOM01"));

        org.mockito.ArgumentCaptor<WsEvent> event = org.mockito.ArgumentCaptor.forClass(WsEvent.class);
        verify(messaging).convertAndSendToUser(eq("host-socket"), eq("/queue/game"), event.capture());
        assertEquals("roomDeleteFailed", event.getValue().type());
    }

    @Test
    void roomRecoveryHandshakeBindsThePreviousMemberAndReturnsRotatedCredentialPrivately() {
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        SessionService sessions = mock(SessionService.class);
        RoomService rooms = mock(RoomService.class);
        UserEntity recoveredUser = user(22L);
        MultiplayerService service = service(messaging, sessions, rooms);
        when(sessions.getUser("reconnect-socket")).thenReturn(null);
        when(rooms.recoverRoomSession("old-room-token"))
                .thenReturn(new RoomService.RoomRecoveryResult(recoveredUser, "rotated-room-token"));

        service.handleHello("reconnect-socket", new HelloAuthRequest("Guest", null, "old-room-token"));

        verify(sessions).bindReconnectUser("reconnect-socket", recoveredUser);
        org.mockito.ArgumentCaptor<WsEvent> event = org.mockito.ArgumentCaptor.forClass(WsEvent.class);
        verify(messaging, org.mockito.Mockito.times(2))
                .convertAndSendToUser(eq("reconnect-socket"), eq("/queue/game"), event.capture());
        WsEvent helloAck = event.getAllValues().stream()
                .filter(candidate -> "helloAck".equals(candidate.type())).findFirst().orElseThrow();
        assertEquals("rotated-room-token", ((HelloAck) helloAck.payload()).roomReconnectToken());
    }

    private MultiplayerService service(SimpMessagingTemplate messaging, SessionService sessions,
                                       RoomService rooms) {
        return new MultiplayerService(messaging, mock(GameRepository.class), mock(GamePlayerRepository.class),
                mock(UserRepository.class), mock(GameService.class), new ClockService(),
                new MatchmakingService(), rooms, sessions, mock(ChessEngine.class),
                60_000L, false, 1600, 12, 200L, 3);
    }

    private UserEntity user(Long id) {
        UserEntity user = new UserEntity();
        ReflectionTestUtils.setField(user, "id", id);
        return user;
    }
}
