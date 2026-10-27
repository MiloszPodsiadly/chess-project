package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameType;
import com.milo.chessdomain.GameVariant;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessserver.game.GameEntity;
import com.milo.chessserver.game.GamePlayerEntity;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.game.MoveValidationService;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.*;

class MultiplayerReconnectTest {

    @Test
    void reconnectTokenRestoresFinalCheckmateSnapshot() {
        GameRepository gameRepository = mock(GameRepository.class);
        GamePlayerRepository playerRepository = mock(GamePlayerRepository.class);
        UserRepository userRepository = mock(UserRepository.class);
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        SessionService sessions = mock(SessionService.class);
        RoomService rooms = mock(RoomService.class);
        ClockService clocks = new ClockService();
        com.milo.chessserver.game.GameService gameService = mock(com.milo.chessserver.game.GameService.class);
        com.milo.chessengine.ChessEngine engine = mock(com.milo.chessengine.ChessEngine.class);

        MultiplayerService service = new MultiplayerService(messaging, gameRepository, playerRepository,
                userRepository, gameService, clocks, new MatchmakingService(),
                rooms, sessions, engine, 60_000L, false, 1600, 12, 200L, 3);
        UUID gameId = UUID.randomUUID();
        GameEntity game = new GameEntity();
        game.setId(gameId);
        game.setGameType(GameType.VS_HUMAN);
        game.setVariant(GameVariant.STANDARD);
        game.setResult(GameResult.WHITE_WIN);
        game.setEndReason(GameEndReason.CHECKMATE);
        game.setCurrentFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        game.setSideToMove(Color.WHITE);
        game.setTimeControlType(TimeControlType.RAPID);
        game.setWhiteTimeLeftMs(1_000L);
        game.setBlackTimeLeftMs(0L);
        game.setLastMoveAt(Instant.now());

        UserEntity user = new UserEntity();
        user.setUsername("finished-player");
        user.setDisplayName("Finished Player");
        org.springframework.test.util.ReflectionTestUtils.setField(user, "id", 81L);
        GamePlayerEntity player = new GamePlayerEntity();
        player.setGame(game);
        player.setUser(user);
        player.setColor(Color.WHITE);
        player.setReconnectToken("one-time-token");

        when(playerRepository.findByReconnectToken("one-time-token")).thenReturn(Optional.of(player));
        when(gameRepository.findLockedById(gameId)).thenReturn(Optional.of(game));
        when(playerRepository.findForReconnectUpdate(eq("one-time-token"), anyString())).thenReturn(Optional.of(player));
        when(gameRepository.findById(gameId)).thenReturn(Optional.of(game));
        when(playerRepository.findByGameIdAndUserId(gameId, 81L)).thenReturn(player);
        when(playerRepository.findByGameId(gameId)).thenReturn(List.of(player));
        when(gameService.loadMoves(gameId)).thenReturn(List.of());
        when(sessions.getUser("new-session")).thenReturn(null);
        when(sessions.getSessionId(81L)).thenReturn("new-session");

        service.handleHello("new-session", new com.milo.chessdomain.multiplayer.HelloAuthRequest(null, "one-time-token"));

        ArgumentCaptor<Object> events = ArgumentCaptor.forClass(Object.class);
        verify(messaging, times(2)).convertAndSendToUser(eq("new-session"), eq("/queue/game"), events.capture());
        assertTrue(events.getAllValues().stream().anyMatch(value -> value instanceof WsEvent event
                && "helloAck".equals(event.type())));
        assertTrue(events.getAllValues().stream().anyMatch(value -> value instanceof WsEvent event
                && "gameStateSync".equals(event.type())));
        assertNotNull(player.getReconnectToken());
        assertFalse("one-time-token".equals(player.getReconnectToken()));
        assertNotNull(player.getPreviousReconnectTokenHash());
        assertNotNull(player.getPreviousReconnectTokenExpiresAt());
        assertNotNull(player.getReconnectAckId());
    }

    @Test
    void reconnectTimeoutEndsGame() {
        GameRepository gameRepository = mock(GameRepository.class);
        GamePlayerRepository playerRepository = mock(GamePlayerRepository.class);
        UserRepository userRepository = mock(UserRepository.class);
        MoveValidationService moveValidationService = new MoveValidationService();
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        SessionService sessionService = mock(SessionService.class);
        MatchmakingService matchmakingService = new MatchmakingService();
        RoomService roomService = mock(RoomService.class);
        com.milo.chessserver.multiplayer.ClockService clockService = new com.milo.chessserver.multiplayer.ClockService();
        com.milo.chessserver.game.GameService gameService = new com.milo.chessserver.game.GameService(
                gameRepository,
                mock(com.milo.chessserver.game.GameMoveRepository.class),
                moveValidationService,
                clockService
        );
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
        game.setGameType(GameType.VS_HUMAN);
        game.setVariant(GameVariant.STANDARD);
        game.setSideToMove(Color.WHITE);
        game.setResult(GameResult.ONGOING);
        game.setTimeControlType(TimeControlType.RAPID);
        game.setStartedAt(Instant.now());

        UserEntity white = new UserEntity();
        white.setUsername("white");
        UserEntity black = new UserEntity();
        black.setUsername("black");

        GamePlayerEntity whitePlayer = new GamePlayerEntity();
        whitePlayer.setGame(game);
        whitePlayer.setUser(white);
        whitePlayer.setColor(Color.WHITE);
        whitePlayer.setLastSeenAt(Instant.now().minusSeconds(120));

        GamePlayerEntity blackPlayer = new GamePlayerEntity();
        blackPlayer.setGame(game);
        blackPlayer.setUser(black);
        blackPlayer.setColor(Color.BLACK);
        blackPlayer.setLastSeenAt(Instant.now());

        when(gameRepository.findIdsByResult(GameResult.ONGOING)).thenReturn(List.of(game.getId()));
        when(gameRepository.findLockedById(game.getId())).thenReturn(Optional.of(game));
        when(playerRepository.findByGameId(game.getId())).thenReturn(List.of(whitePlayer, blackPlayer));
        when(gameRepository.save(any(GameEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        multiplayerService.handleReconnectTimeouts(Duration.ofSeconds(30));

        ArgumentCaptor<GameEntity> captor = ArgumentCaptor.forClass(GameEntity.class);
        verify(gameRepository, atLeastOnce()).save(captor.capture());
        GameEntity saved = captor.getValue();
        assertEquals(GameResult.BLACK_WIN, saved.getResult());
        assertEquals(GameEndReason.DISCONNECT_TIMEOUT, saved.getEndReason());
    }
}
