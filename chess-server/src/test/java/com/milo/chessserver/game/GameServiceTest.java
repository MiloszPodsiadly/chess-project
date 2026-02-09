package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.game.MoveDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GameServiceTest {

    private GameRepository gameRepository;
    private GameMoveRepository moveRepository;
    private MoveValidationService moveValidationService;
    private GameService gameService;

    @BeforeEach
    void setUp() {
        gameRepository = mock(GameRepository.class);
        moveRepository = mock(GameMoveRepository.class);
        moveValidationService = new MoveValidationService();
        gameService = new GameService(gameRepository, moveRepository, moveValidationService, new com.milo.chessserver.multiplayer.ClockService());
    }

    @Test
    void applyMovePersistsMoveAndUpdatesGame() {
        UUID gameId = UUID.randomUUID();
        GameEntity game = new GameEntity();
        game.setId(gameId);
        game.setCurrentFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        game.setSideToMove(Color.WHITE);
        game.setResult(GameResult.ONGOING);
        game.setTimeControlType(TimeControlType.UNTIMED);
        game.setStartedAt(Instant.now());

        when(gameRepository.findById(gameId)).thenReturn(Optional.of(game));
        when(gameRepository.save(any(GameEntity.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(moveRepository.countByGameId(gameId)).thenReturn(0L);
        when(moveRepository.findFenAfterMoveByGameIdOrderByMoveNumberAsc(gameId)).thenReturn(List.of());

        String originalFen = game.getCurrentFen();
        MoveDto move = new MoveDto("e2", "e4", null, Color.WHITE);

        GameEntity updated = gameService.applyMove(gameId, move);

        assertEquals(GameResult.ONGOING, updated.getResult());
        assertEquals(Color.BLACK, updated.getSideToMove());
        assertNotEquals(originalFen, updated.getCurrentFen());

        ArgumentCaptor<GameMoveEntity> captor = ArgumentCaptor.forClass(GameMoveEntity.class);
        verify(moveRepository, times(1)).save(captor.capture());
        GameMoveEntity saved = captor.getValue();
        assertEquals("e2", saved.getFromSquare());
        assertEquals("e4", saved.getToSquare());
        assertEquals(Color.WHITE, saved.getPlayerColor());
    }

    @Test
    void applyMoveThrowsOnIllegalMove() {
        UUID gameId = UUID.randomUUID();
        GameEntity game = new GameEntity();
        game.setId(gameId);
        game.setCurrentFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        game.setSideToMove(Color.WHITE);
        game.setResult(GameResult.ONGOING);
        game.setTimeControlType(TimeControlType.UNTIMED);
        game.setStartedAt(Instant.now());

        when(gameRepository.findById(gameId)).thenReturn(Optional.of(game));
        when(moveRepository.findFenAfterMoveByGameIdOrderByMoveNumberAsc(gameId)).thenReturn(List.of());

        MoveDto move = new MoveDto("e2", "e5", null, Color.WHITE);

        assertThrows(IllegalArgumentException.class, () -> gameService.applyMove(gameId, move));
        verify(moveRepository, never()).save(any());
    }
}
