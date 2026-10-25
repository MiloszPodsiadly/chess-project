package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameType;
import com.milo.chessdomain.GameTurnState;
import com.milo.chessengine.ChessEngine;
import com.milo.chessserver.multiplayer.ClockService;
import com.milo.chessserver.user.UserEntity;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutorService;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class EngineGameServiceTest {
    @Test
    void repeatedRetryKeepsOneExecutionOwnerAndReturnsPendingImmediately() {
        GameRepository games = mock(GameRepository.class);
        GamePlayerRepository players = mock(GamePlayerRepository.class);
        ChessEngine engine = mock(ChessEngine.class);
        GameService gameService = mock(GameService.class);
        TransactionTemplate transactions = mock(TransactionTemplate.class);
        ExecutorService executor = mock(ExecutorService.class);
        when(transactions.execute(any())).thenAnswer(invocation ->
                ((org.springframework.transaction.support.TransactionCallback<?>) invocation.getArgument(0))
                        .doInTransaction(null));

        UserEntity user = new UserEntity();
        ReflectionTestUtils.setField(user, "id", 42L);
        GameEntity game = new GameEntity();
        game.setId(UUID.randomUUID());
        game.setGameType(GameType.VS_ENGINE);
        game.setWhitePlayer(user);
        game.setResult(GameResult.ONGOING);
        game.setEngineTurnState(GameTurnState.ENGINE_FAILED);
        game.setCurrentFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP b KQkq - 0 1");
        game.setSideToMove(Color.BLACK);
        when(games.findLockedById(game.getId())).thenReturn(Optional.of(game));
        when(games.findById(game.getId())).thenReturn(Optional.of(game));
        when(gameService.loadMoves(game.getId())).thenReturn(List.of());

        EngineGameService service = new EngineGameService(games, players, engine, gameService,
                mock(ClockService.class), transactions, executor);
        var first = service.retryEngineTurn(game.getId(), user);
        var second = service.retryEngineTurn(game.getId(), user);

        assertEquals(GameTurnState.ENGINE_THINKING, first.turnState());
        assertNotNull(first.engineExecutionId());
        assertEquals(first.engineExecutionId(), second.engineExecutionId());
        assertEquals(1, game.getEngineAttempts());
        verify(executor, times(1)).execute(any(Runnable.class));
        verifyNoInteractions(engine);
    }
}
