package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessdomain.multiplayer.GameStartedEvent;
import com.milo.chessdomain.multiplayer.MoveAcceptedEvent;
import com.milo.chessserver.game.GameEntity;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.game.GameService;
import com.milo.chessserver.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.*;

class MultiplayerEventPayloadTest {

    @Test
    void gameStartedIncludesLastMoveAt() throws Exception {
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        GameRepository gameRepository = mock(GameRepository.class);
        GamePlayerRepository playerRepository = mock(GamePlayerRepository.class);
        UserRepository userRepository = mock(UserRepository.class);
        GameService gameService = mock(GameService.class);
        ClockService clockService = new ClockService();
        MatchmakingService matchmakingService = new MatchmakingService();
        RoomService roomService = mock(RoomService.class);
        SessionService sessionService = mock(SessionService.class);
        com.milo.chessengine.ChessEngine chessEngine = mock(com.milo.chessengine.ChessEngine.class);

        MultiplayerService multiplayerService = new MultiplayerService(
                messagingTemplate,
                gameRepository,
                playerRepository,
                userRepository,
                gameService,
                clockService,
                matchmakingService,
                roomService,
                sessionService,
                chessEngine,
                1000L,
                false,
                1600,
                12,
                200L,
                3
        );

        GameEntity game = new GameEntity();
        game.setId(UUID.randomUUID());
        game.setTimeControlType(TimeControlType.RAPID);
        game.setCurrentFen("startpos");
        game.setSideToMove(Color.WHITE);
        game.setWhiteTimeLeftMs(600_000L);
        game.setBlackTimeLeftMs(600_000L);
        Instant startedAt = Instant.now();
        game.setLastMoveAt(startedAt);

        Long userId = 1L;
        when(sessionService.getSessionId(userId)).thenReturn("session-1");
        when(roomService.findRoomCodeByGame(game.getId())).thenReturn(null);

        Method method = MultiplayerService.class.getDeclaredMethod(
                "sendGameStarted",
                GameEntity.class,
                Long.class,
                String.class,
                Color.class
        );
        method.setAccessible(true);
        method.invoke(multiplayerService, game, userId, "token", Color.WHITE);

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSendToUser(eq("session-1"), eq("/queue/game"), payloadCaptor.capture());
        WsEvent event = (WsEvent) payloadCaptor.getValue();
        assertEquals("gameStarted", event.type());
        GameStartedEvent payload = (GameStartedEvent) event.payload();
        assertNotNull(payload.lastMoveAt());
        assertEquals(startedAt, payload.lastMoveAt());
    }

    @Test
    void moveAcceptedIncludesLastMoveAt() throws Exception {
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        GameRepository gameRepository = mock(GameRepository.class);
        GamePlayerRepository playerRepository = mock(GamePlayerRepository.class);
        UserRepository userRepository = mock(UserRepository.class);
        GameService gameService = mock(GameService.class);
        ClockService clockService = new ClockService();
        MatchmakingService matchmakingService = new MatchmakingService();
        RoomService roomService = mock(RoomService.class);
        SessionService sessionService = mock(SessionService.class);
        com.milo.chessengine.ChessEngine chessEngine = mock(com.milo.chessengine.ChessEngine.class);

        MultiplayerService multiplayerService = new MultiplayerService(
                messagingTemplate,
                gameRepository,
                playerRepository,
                userRepository,
                gameService,
                clockService,
                matchmakingService,
                roomService,
                sessionService,
                chessEngine,
                1000L,
                false,
                1600,
                12,
                200L,
                3
        );

        GameEntity game = new GameEntity();
        UUID gameId = UUID.randomUUID();
        game.setId(gameId);
        game.setCurrentFen("startpos");
        game.setSideToMove(Color.BLACK);
        game.setWhiteTimeLeftMs(600_000L);
        game.setBlackTimeLeftMs(600_000L);
        Instant lastMoveAt = Instant.now();
        game.setLastMoveAt(lastMoveAt);

        MoveDto move = new MoveDto("e2", "e4", null, Color.WHITE);

        Method method = MultiplayerService.class.getDeclaredMethod(
                "sendMoveAccepted",
                GameEntity.class,
                MoveDto.class
        );
        method.setAccessible(true);
        method.invoke(multiplayerService, game, move);

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSend(eq("/topic/game/" + gameId), payloadCaptor.capture());
        WsEvent event = (WsEvent) payloadCaptor.getValue();
        assertEquals("moveAccepted", event.type());
        MoveAcceptedEvent payload = (MoveAcceptedEvent) event.payload();
        assertNotNull(payload.lastMoveAt());
        assertEquals(lastMoveAt, payload.lastMoveAt());
    }
}
