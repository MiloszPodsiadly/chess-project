package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameVariant;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessserver.multiplayer.ClockService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

@DataJpaTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:chess-move-concurrency;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({GameService.class, MoveValidationService.class, ClockService.class})
@org.springframework.transaction.annotation.Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
class MultiplayerMoveConcurrencyTest {
    private static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    @Autowired private GameService gameService;
    @Autowired private GameRepository gameRepository;
    @Autowired private GameMoveRepository moveRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void concurrentIdenticalMovesPersistOnlyOneAcceptedMove() throws Exception {
        verifyOnlyOneConcurrentWhiteMoveIsAccepted(
                new MoveDto("e2", "e4", null, Color.WHITE),
                new MoveDto("e2", "e4", null, Color.WHITE));
    }

    @Test
    void concurrentMovesFromTheSamePositionPersistOnlyOneMove() throws Exception {
        verifyOnlyOneConcurrentWhiteMoveIsAccepted(
                new MoveDto("e2", "e4", null, Color.WHITE),
                new MoveDto("d2", "d4", null, Color.WHITE));
    }

    @Test
    void moveSubmittedAfterClockExpiryEndsTheGameWithoutPersistingTheMove() {
        UUID gameId = createExpiredTimedGame();

        GameService.MultiplayerMoveResult result = gameService.applyMultiplayerMove(
                gameId, new MoveDto("e2", "e4", null, Color.WHITE), Color.WHITE, Instant.now());

        assertFalse(result.accepted());
        assertEquals("time_out", result.rejectionReason());
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> {
            GameEntity game = gameRepository.findById(gameId).orElseThrow();
            assertEquals(GameResult.BLACK_WIN, game.getResult());
            assertEquals(GameEndReason.TIME_OUT, game.getEndReason());
            assertEquals(0L, game.getWhiteTimeLeftMs());
            assertEquals(0L, moveRepository.countByGameId(gameId));
        });
    }

    private void verifyOnlyOneConcurrentWhiteMoveIsAccepted(MoveDto first, MoveDto second) throws Exception {
        UUID gameId = createGame();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<GameService.MultiplayerMoveResult> firstResult = executor.submit(() -> submitMove(gameId, first, ready, start));
            Future<GameService.MultiplayerMoveResult> secondResult = executor.submit(() -> submitMove(gameId, second, ready, start));
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();

            GameService.MultiplayerMoveResult one = firstResult.get(10, TimeUnit.SECONDS);
            GameService.MultiplayerMoveResult two = secondResult.get(10, TimeUnit.SECONDS);

            assertEquals(1, List.of(one, two).stream().filter(GameService.MultiplayerMoveResult::accepted).count());
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
            transaction.executeWithoutResult(status -> {
                assertEquals(1L, moveRepository.countByGameId(gameId));
                GameEntity game = gameRepository.findById(gameId).orElseThrow();
                assertEquals(Color.BLACK, game.getSideToMove());
                assertEquals(GameResult.ONGOING, game.getResult());
            });
        } finally {
            start.countDown();
            executor.shutdownNow();
        }
    }

    private GameService.MultiplayerMoveResult submitMove(UUID gameId,
                                                          MoveDto move,
                                                          CountDownLatch ready,
                                                          CountDownLatch start) throws InterruptedException {
        ready.countDown();
        if (!start.await(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("Timed out waiting to start concurrent moves");
        }
        return gameService.applyMultiplayerMove(gameId, move, Color.WHITE, Instant.now());
    }

    private UUID createGame() {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction.execute(status -> {
            GameEntity game = new GameEntity();
            game.setId(UUID.randomUUID());
            game.setGameType(com.milo.chessdomain.GameType.VS_HUMAN);
            game.setVariant(GameVariant.STANDARD);
            game.setSideToMove(Color.WHITE);
            game.setCurrentFen(START_FEN);
            game.setResult(GameResult.ONGOING);
            game.setEndReason(GameEndReason.NONE);
            game.setTimeControlType(TimeControlType.UNTIMED);
            game.setWhiteTimeLeftMs(0L);
            game.setBlackTimeLeftMs(0L);
            game.setStartedAt(Instant.now());
            game.setLastMoveAt(game.getStartedAt());
            return gameRepository.save(game).getId();
        });
    }

    private UUID createExpiredTimedGame() {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction.execute(status -> {
            GameEntity game = new GameEntity();
            game.setId(UUID.randomUUID());
            game.setGameType(com.milo.chessdomain.GameType.VS_HUMAN);
            game.setVariant(GameVariant.STANDARD);
            game.setSideToMove(Color.WHITE);
            game.setCurrentFen(START_FEN);
            game.setResult(GameResult.ONGOING);
            game.setEndReason(GameEndReason.NONE);
            game.setTimeControlType(TimeControlType.BLITZ);
            game.setWhiteTimeLeftMs(1L);
            game.setBlackTimeLeftMs(5_000L);
            game.setStartedAt(Instant.now().minusSeconds(2));
            game.setLastMoveAt(game.getStartedAt());
            return gameRepository.save(game).getId();
        });
    }
}
