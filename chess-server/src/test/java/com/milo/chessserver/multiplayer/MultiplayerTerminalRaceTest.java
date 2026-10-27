package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameType;
import com.milo.chessdomain.GameVariant;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.multiplayer.AcceptDrawRequest;
import com.milo.chessdomain.multiplayer.GameEndedEvent;
import com.milo.chessdomain.multiplayer.OfferDrawRequest;
import com.milo.chessdomain.multiplayer.ResignRequest;
import com.milo.chessserver.game.GameEntity;
import com.milo.chessserver.game.GamePlayerEntity;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.game.GameService;
import com.milo.chessserver.game.MoveValidationService;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import com.milo.chessengine.ChessEngine;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DataJpaTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:chess-terminal-races;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({GameService.class, MoveValidationService.class, ClockService.class,
        MultiplayerService.class, MultiplayerTerminalRaceTest.TestBeans.class})
@org.springframework.transaction.annotation.Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
class MultiplayerTerminalRaceTest {
    private static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    @Autowired private MultiplayerService multiplayerService;
    @Autowired private SessionService sessions;
    @Autowired private SimpMessagingTemplate messaging;
    @Autowired private GameRepository gameRepository;
    @Autowired private GamePlayerRepository playerRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void timeoutAndResignationRaceProducesOneTimeoutOutcome() throws Exception {
        Setup setup = createGame(true);
        bindSessions(setup);

        runTogether(
                () -> multiplayerService.resign("ws-white", new ResignRequest(setup.gameId())),
                multiplayerService::handleClockTimeouts);

        GameEntity finished = loadGame(setup.gameId());
        assertEquals(GameResult.BLACK_WIN, finished.getResult());
        assertEquals(GameEndReason.TIME_OUT, finished.getEndReason());
        assertEquals(1L, finished.getVersion());
        assertSingleGameEndedEvent(setup.gameId());
    }

    @Test
    void simultaneousDrawAcceptancesCommitOnlyOneTerminalTransition() throws Exception {
        Setup setup = createGame(false);
        bindSessions(setup);
        multiplayerService.offerDraw("ws-white", new OfferDrawRequest(setup.gameId(), START_FEN,
                Color.WHITE, 0L, 0L));

        AcceptDrawRequest accept = new AcceptDrawRequest(setup.gameId(), START_FEN, Color.WHITE, 0L, 0L);
        runTogether(
                () -> multiplayerService.acceptDraw("ws-black", accept),
                () -> multiplayerService.acceptDraw("ws-black", accept));

        GameEntity finished = loadGame(setup.gameId());
        assertEquals(GameResult.DRAW, finished.getResult());
        assertEquals(GameEndReason.AGREED_DRAW, finished.getEndReason());
        assertSingleGameEndedEvent(setup.gameId());
    }

    private Setup createGame(boolean expiredClock) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction.execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            UserEntity white = user("white-" + suffix, "white-" + suffix + "@test.local");
            UserEntity black = user("black-" + suffix, "black-" + suffix + "@test.local");
            userRepository.save(white);
            userRepository.save(black);

            Instant started = expiredClock ? Instant.now().minusSeconds(3) : Instant.now();
            GameEntity game = new GameEntity();
            game.setId(UUID.randomUUID());
            game.setWhitePlayer(white);
            game.setBlackPlayer(black);
            game.setGameType(GameType.VS_HUMAN);
            game.setVariant(GameVariant.STANDARD);
            game.setSideToMove(Color.WHITE);
            game.setCurrentFen(START_FEN);
            game.setResult(GameResult.ONGOING);
            game.setEndReason(GameEndReason.NONE);
            game.setTimeControlType(expiredClock ? TimeControlType.BLITZ : TimeControlType.UNTIMED);
            game.setWhiteTimeLeftMs(expiredClock ? 1L : 0L);
            game.setBlackTimeLeftMs(expiredClock ? 5_000L : 0L);
            game.setStartedAt(started);
            game.setLastMoveAt(started);
            gameRepository.save(game);

            playerRepository.save(gamePlayer(game, white, Color.WHITE));
            playerRepository.save(gamePlayer(game, black, Color.BLACK));
            return new Setup(game.getId(), white, black);
        });
    }

    private UserEntity user(String username, String email) {
        UserEntity user = new UserEntity();
        user.setUsername(username);
        user.setEmail(email);
        user.setPasswordHash("not-used");
        return user;
    }

    private GamePlayerEntity gamePlayer(GameEntity game, UserEntity user, Color color) {
        GamePlayerEntity player = new GamePlayerEntity();
        player.setGame(game);
        player.setUser(user);
        player.setColor(color);
        player.setPlayerType(com.milo.chessdomain.PlayerType.HUMAN);
        player.setRatingAtStart(1200);
        player.setReconnectToken(UUID.randomUUID().toString().replace("-", ""));
        return player;
    }

    private void bindSessions(Setup setup) {
        when(sessions.getUser("ws-white")).thenReturn(setup.white());
        when(sessions.getUser("ws-black")).thenReturn(setup.black());
        when(sessions.getSessionId(setup.white().getId())).thenReturn("ws-white");
        when(sessions.getSessionId(setup.black().getId())).thenReturn("ws-black");
    }

    private GameEntity loadGame(UUID gameId) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction.execute(status -> gameRepository.findById(gameId).orElseThrow());
    }

    private void runTogether(Runnable first, Runnable second) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<?> one = executor.submit(() -> runWhenReleased(first, ready, start));
            Future<?> two = executor.submit(() -> runWhenReleased(second, ready, start));
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();
            one.get(10, TimeUnit.SECONDS);
            two.get(10, TimeUnit.SECONDS);
        } finally {
            start.countDown();
            executor.shutdownNow();
        }
    }

    private void runWhenReleased(Runnable action, CountDownLatch ready, CountDownLatch start) {
        ready.countDown();
        try {
            if (!start.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Timed out waiting to start");
            action.run();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }

    private void assertSingleGameEndedEvent(UUID gameId) {
        org.mockito.ArgumentCaptor<Object> captor = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeastOnce()).convertAndSend(anyString(), captor.capture());
        List<WsEvent> events = new ArrayList<>();
        for (Object value : captor.getAllValues()) {
            if (value instanceof WsEvent event && "gameEnded".equals(event.type())
                    && event.payload() instanceof GameEndedEvent ended && gameId.equals(ended.gameId())) {
                events.add(event);
            }
        }
        assertEquals(1, events.size(), () -> events.stream()
                .map(event -> ((GameEndedEvent) event.payload()).version()).toList().toString());
        GameEndedEvent ended = (GameEndedEvent) events.get(0).payload();
        assertEquals(gameId, ended.gameId());
    }

    private record Setup(UUID gameId, UserEntity white, UserEntity black) {}

    @TestConfiguration
    static class TestBeans {
        @Bean SimpMessagingTemplate simpMessagingTemplate() { return mock(SimpMessagingTemplate.class); }
        @Bean SessionService sessionService() { return mock(SessionService.class); }
        @Bean RoomService roomService() { return mock(RoomService.class); }
        @Bean ChessEngine chessEngine() { return mock(ChessEngine.class); }
        @Bean MatchmakingService matchmakingService() { return new MatchmakingService(new BCryptPasswordEncoder()); }
    }
}
