package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameType;
import com.milo.chessdomain.GameVariant;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessserver.game.GameEntity;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.game.GameService;
import com.milo.chessserver.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

class ClockTimeoutTest {

    @Test
    void sideToMoveTimeoutEndsGame() {
        GameRepository gameRepository = mock(GameRepository.class);
        GamePlayerRepository playerRepository = mock(GamePlayerRepository.class);
        UserRepository userRepository = mock(UserRepository.class);
        GameService gameService = mock(GameService.class);
        MatchmakingService matchmakingService = new MatchmakingService(new BCryptPasswordEncoder());
        SessionService sessionService = mock(SessionService.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);
        ClockService clockService = new ClockService();
        RoomService roomService = mock(RoomService.class);
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
        game.setTimeControlType(TimeControlType.BLITZ);
        game.setWhiteTimeLeftMs(0L);
        game.setBlackTimeLeftMs(1000L);
        game.setStartedAt(Instant.now().minusSeconds(60));
        game.setLastMoveAt(Instant.now().minusSeconds(10));

        when(gameRepository.findByResult(GameResult.ONGOING)).thenReturn(List.of(game));
        when(gameRepository.save(any(GameEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        multiplayerService.handleClockTimeouts();

        ArgumentCaptor<GameEntity> captor = ArgumentCaptor.forClass(GameEntity.class);
        verify(gameRepository, atLeastOnce()).save(captor.capture());
        GameEntity saved = captor.getValue();
        assertEquals(GameResult.BLACK_WIN, saved.getResult());
        assertEquals(GameEndReason.TIME_OUT, saved.getEndReason());
    }
}
