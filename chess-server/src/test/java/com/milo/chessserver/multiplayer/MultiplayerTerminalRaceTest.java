package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameType;
import com.milo.chessdomain.GameVariant;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.multiplayer.AcceptDrawRequest;
import com.milo.chessdomain.multiplayer.GameEndedEvent;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessdomain.multiplayer.OfferDrawRequest;
import com.milo.chessdomain.multiplayer.ResignRequest;
import com.milo.chessdomain.multiplayer.MakeMoveRequest;
import com.milo.chessdomain.multiplayer.MoveAcceptedEvent;
import com.milo.chessdomain.multiplayer.MoveRejectedEvent;
import com.milo.chessdomain.multiplayer.HelloAck;
import com.milo.chessdomain.multiplayer.HelloAuthRequest;
import com.milo.chessdomain.multiplayer.ReconnectAckRequest;
import com.milo.chessdomain.multiplayer.QueueMatchmakingRequest;
import com.milo.chessserver.game.GameEntity;
import com.milo.chessserver.game.GamePlayerEntity;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameMoveRepository;
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
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.dao.DataAccessResourceFailureException;

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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;

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
    @SpyBean private GameRepository gameRepository;
    @Autowired private GameService gameService;
    @Autowired private ClockService clockService;
    @Autowired private MatchmakingService matchmakingService;
    @Autowired private RoomService roomService;
    @Autowired private ChessEngine chessEngine;
    @Autowired private GamePlayerRepository playerRepository;
    @Autowired private GameMoveRepository moveRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void matchingCreatesOneGameAndPublishesStartedEventsAfterCommit() {
        UserEntity first = storeQueueUser("queue-first");
        UserEntity second = storeQueueUser("queue-second");
        bindQueueSessions(first, second, "queue-first-session", "queue-second-session");
        long gameCount = gameRepository.count();

        multiplayerService.queueMatchmaking("queue-first-session", new QueueMatchmakingRequest(TimeControlType.RAPID));
        assertEquals(gameCount, gameRepository.count());
        org.mockito.Mockito.clearInvocations(messaging);

        multiplayerService.queueMatchmaking("queue-second-session", new QueueMatchmakingRequest(TimeControlType.RAPID));

        assertEquals(gameCount + 1, gameRepository.count());
        GameEntity created = gameRepository.findByWhitePlayerOrBlackPlayer(first, first).stream()
                .filter(game -> playerRepository.findByGameIdAndUserId(game.getId(), second.getId()) != null)
                .findFirst().orElseThrow();
        assertEquals(2, playerRepository.findByGameId(created.getId()).size());

        org.mockito.ArgumentCaptor<Object> messages = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeastOnce()).convertAndSendToUser(anyString(), eq("/queue/game"), messages.capture());
        long gameStartedCount = messages.getAllValues().stream()
                .filter(WsEvent.class::isInstance).map(WsEvent.class::cast)
                .filter(event -> "gameStarted".equals(event.type())).count();
        assertEquals(2, gameStartedCount);
    }

    @Test
    void databaseTimeoutDuringGameInsertRestoresConnectedPlayersWithoutPublishingAMatch() {
        UserEntity first = storeQueueUser("timeout-first");
        UserEntity second = storeQueueUser("timeout-second");
        bindQueueSessions(first, second, "timeout-first-session", "timeout-second-session");
        multiplayerService.queueMatchmaking("timeout-first-session", new QueueMatchmakingRequest(TimeControlType.RAPID));
        org.mockito.Mockito.clearInvocations(messaging);
        doThrow(new DataAccessResourceFailureException("simulated database timeout"))
                .when(gameRepository).save(any(GameEntity.class));

        assertThrows(DataAccessResourceFailureException.class, () -> multiplayerService.queueMatchmaking(
                "timeout-second-session", new QueueMatchmakingRequest(TimeControlType.RAPID)));
        org.mockito.ArgumentCaptor<Object> messages = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeastOnce()).convertAndSendToUser(anyString(), eq("/queue/game"), messages.capture());
        assertTrue(messages.getAllValues().stream().filter(WsEvent.class::isInstance).map(WsEvent.class::cast)
                .noneMatch(event -> "gameStarted".equals(event.type())));

        MatchmakingService.QueueResult retry = matchmakingService.enqueueOrMatch(
                new MatchmakingService.QueueEntry(9_999_001L, TimeControlType.RAPID, Instant.now()), ignored -> true);
        assertEquals(first.getId(), retry.matchedEntry().userId());
        matchmakingService.rollbackMatch(retry.reservationId(), ignored -> true);
        assertEquals(MatchmakingService.CancelResult.CANCELED, matchmakingService.cancel(first.getId()));
        assertEquals(MatchmakingService.CancelResult.CANCELED, matchmakingService.cancel(second.getId()));
    }

    @Test
    void pendingReconnectRotationSurvivesSessionServiceRestartAndCanBeAcknowledged() {
        Setup setup = createGame(false);
        GamePlayerEntity player = playerRepository.findByGameIdAndUserId(setup.gameId(), setup.white().getId());
        String originalToken = player.getReconnectToken();
        org.mockito.Mockito.clearInvocations(messaging);
        when(sessions.getUser("lost-ack-socket")).thenReturn(null);

        multiplayerService.handleHello("lost-ack-socket", new HelloAuthRequest(null, originalToken));

        org.mockito.ArgumentCaptor<Object> initialMessages = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeastOnce()).convertAndSendToUser(
                org.mockito.ArgumentMatchers.eq("lost-ack-socket"),
                org.mockito.ArgumentMatchers.eq("/queue/game"), initialMessages.capture());
        HelloAck firstAck = initialMessages.getAllValues().stream()
                .filter(WsEvent.class::isInstance).map(WsEvent.class::cast)
                .filter(event -> "helloAck".equals(event.type())).map(event -> (HelloAck) event.payload())
                .findFirst().orElseThrow();
        assertNotNull(firstAck.reconnectAckId());
        assertNotNull(firstAck.reconnectToken());

        SessionService restartedSessions = new SessionService(userRepository, new BCryptPasswordEncoder());
        MultiplayerService restartedService = new MultiplayerService(messaging, gameRepository, playerRepository,
                userRepository, gameService, clockService, matchmakingService, roomService, restartedSessions,
                chessEngine, 120_000L, false, 1600, 12, 200L, 3);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.executeWithoutResult(status ->
                restartedService.handleHello("restarted-socket", new HelloAuthRequest(null, originalToken)));

        org.mockito.ArgumentCaptor<Object> recoveredMessages = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeastOnce()).convertAndSendToUser(
                org.mockito.ArgumentMatchers.eq("restarted-socket"),
                org.mockito.ArgumentMatchers.eq("/queue/game"), recoveredMessages.capture());
        HelloAck recoveredAck = recoveredMessages.getAllValues().stream()
                .filter(WsEvent.class::isInstance).map(WsEvent.class::cast)
                .filter(event -> "helloAck".equals(event.type())).map(event -> (HelloAck) event.payload())
                .findFirst().orElseThrow();
        assertEquals(firstAck.reconnectToken(), recoveredAck.reconnectToken());
        assertEquals(firstAck.reconnectAckId(), recoveredAck.reconnectAckId());
        assertEquals(setup.white().getId(), restartedSessions.getUser("restarted-socket").getId());
        assertEquals(2, playerRepository.findByGameId(setup.gameId()).size());

        transaction.executeWithoutResult(status -> restartedService.acknowledgeReconnect("restarted-socket",
                new ReconnectAckRequest(setup.gameId().toString(), recoveredAck.reconnectAckId())));
        GamePlayerEntity acknowledged = playerRepository.findByGameIdAndUserId(setup.gameId(), setup.white().getId());
        assertEquals(recoveredAck.reconnectToken(), acknowledged.getReconnectToken());
        assertNull(acknowledged.getPreviousReconnectTokenHash());
        assertNull(acknowledged.getReconnectAckId());
    }

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

    @Test
    void checkmatePublishesCommittedJpaVersionAndFinishedGameRejectsBothPlayers() {
        Setup setup = createGame(false);
        bindSessions(setup);
        assertEquals(0L, loadGame(setup.gameId()).getVersion());

        List<Ply> foolsMate = List.of(
                new Ply("ws-white", new MoveDto("f2", "f3", null, Color.WHITE)),
                new Ply("ws-black", new MoveDto("e7", "e5", null, Color.BLACK)),
                new Ply("ws-white", new MoveDto("g2", "g4", null, Color.WHITE)),
                new Ply("ws-black", new MoveDto("d8", "h4", null, Color.BLACK))
        );
        for (int index = 0; index < foolsMate.size(); index++) {
            GameEntity before = loadGame(setup.gameId());
            assertEquals((long) index, before.getVersion());
            multiplayerService.makeMove(foolsMate.get(index).session(), new MakeMoveRequest(
                    setup.gameId(), foolsMate.get(index).move(), before.getVersion()));
            assertEquals((long) index + 1, loadGame(setup.gameId()).getVersion());
        }

        GameEntity finished = loadGame(setup.gameId());
        assertEquals(GameResult.BLACK_WIN, finished.getResult());
        assertEquals(GameEndReason.CHECKMATE, finished.getEndReason());
        assertEquals("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
                finished.getCurrentFen());
        assertEquals(4L, moveRepository.countByGameId(setup.gameId()));

        multiplayerService.makeMove("ws-white", new MakeMoveRequest(setup.gameId(),
                new MoveDto("a2", "a3", null, Color.WHITE), finished.getVersion()));
        multiplayerService.makeMove("ws-black", new MakeMoveRequest(setup.gameId(),
                new MoveDto("a7", "a6", null, Color.BLACK), finished.getVersion()));

        GameEntity afterRejectedMoves = loadGame(setup.gameId());
        assertEquals(finished.getVersion(), afterRejectedMoves.getVersion());
        assertEquals(finished.getCurrentFen(), afterRejectedMoves.getCurrentFen());
        assertEquals(4L, moveRepository.countByGameId(setup.gameId()));

        org.mockito.ArgumentCaptor<Object> captor = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeastOnce()).convertAndSend(
                org.mockito.ArgumentMatchers.eq("/topic/game/" + setup.gameId()), captor.capture());
        List<WsEvent> events = captor.getAllValues().stream()
                .filter(WsEvent.class::isInstance)
                .map(WsEvent.class::cast)
                .toList();
        List<MoveAcceptedEvent> accepted = events.stream()
                .filter(event -> "moveAccepted".equals(event.type()))
                .map(event -> (MoveAcceptedEvent) event.payload())
                .toList();
        List<GameEndedEvent> ended = events.stream()
                .filter(event -> "gameEnded".equals(event.type()))
                .map(event -> (GameEndedEvent) event.payload())
                .toList();
        List<WsEvent> rejected = events.stream()
                .filter(event -> "moveRejected".equals(event.type()))
                .toList();

        assertEquals(4, accepted.size());
        assertEquals(List.of(1L, 2L, 3L, 4L), accepted.stream().map(MoveAcceptedEvent::version).toList());
        assertEquals(1, ended.size());
        MoveAcceptedEvent matingMove = accepted.get(3);
        GameEndedEvent terminal = ended.get(0);
        assertEquals(4L, matingMove.version());
        assertEquals(matingMove.version(), terminal.version());
        assertEquals(finished.getCurrentFen(), matingMove.fen());
        assertEquals(finished.getCurrentFen(), terminal.fen());
        assertEquals(GameResult.BLACK_WIN, terminal.result());
        assertEquals(GameEndReason.CHECKMATE, terminal.endReason());
        assertEquals(foolsMate.stream().map(Ply::move).toList(), terminal.moves());
        assertEquals(matingMove.whiteTimeLeftMs(), terminal.whiteTimeLeftMs());
        assertEquals(matingMove.blackTimeLeftMs(), terminal.blackTimeLeftMs());
        assertEquals(2, rejected.size());
        assertTrue(rejected.stream().allMatch(event ->
                "game_finished".equals(((MoveRejectedEvent) event.payload()).reason())));
        assertEquals("moveAccepted", events.get(events.size() - 4).type());
        assertEquals("gameEnded", events.get(events.size() - 3).type());
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

    private UserEntity storeQueueUser(String prefix) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction.execute(status -> {
            String suffix = UUID.randomUUID().toString().substring(0, 8);
            UserEntity created = user(prefix + "-" + suffix, prefix + "-" + suffix + "@test.local");
            return userRepository.save(created);
        });
    }

    private void bindQueueSessions(UserEntity first, UserEntity second, String firstSession, String secondSession) {
        when(sessions.getUser(firstSession)).thenReturn(first);
        when(sessions.getUser(secondSession)).thenReturn(second);
        when(sessions.getSessionId(first.getId())).thenReturn(firstSession);
        when(sessions.getSessionId(second.getId())).thenReturn(secondSession);
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
    private record Ply(String session, MoveDto move) {}

    @TestConfiguration
    static class TestBeans {
        @Bean SimpMessagingTemplate simpMessagingTemplate() { return mock(SimpMessagingTemplate.class); }
        @Bean SessionService sessionService() { return mock(SessionService.class); }
        @Bean RoomService roomService() { return mock(RoomService.class); }
        @Bean ChessEngine chessEngine() { return mock(ChessEngine.class); }
        @Bean MatchmakingService matchmakingService() { return new MatchmakingService(); }
    }
}
