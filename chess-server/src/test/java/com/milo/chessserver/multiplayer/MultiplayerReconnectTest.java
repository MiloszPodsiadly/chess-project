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
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

class MultiplayerReconnectTest {

    @Test
    void reconnectTimeoutEndsGame() {
        GameRepository gameRepository = mock(GameRepository.class);
        GamePlayerRepository playerRepository = mock(GamePlayerRepository.class);
        UserRepository userRepository = mock(UserRepository.class);
        MoveValidationService moveValidationService = new MoveValidationService();
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        SessionService sessionService = mock(SessionService.class);
        MatchmakingService matchmakingService = new MatchmakingService(new BCryptPasswordEncoder());
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

        when(gameRepository.findByResult(GameResult.ONGOING)).thenReturn(List.of(game));
        when(playerRepository.findByGameId(game.getId())).thenReturn(List.of(whitePlayer, blackPlayer));
        when(gameRepository.save(any(GameEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        multiplayerService.handleReconnectTimeouts(Duration.ofSeconds(30));

        ArgumentCaptor<GameEntity> captor = ArgumentCaptor.forClass(GameEntity.class);
        verify(gameRepository, atLeastOnce()).save(captor.capture());
        GameEntity saved = captor.getValue();
        assertEquals(GameResult.BLACK_WIN, saved.getResult());
        assertEquals(GameEndReason.TIME_OUT, saved.getEndReason());
    }
}
