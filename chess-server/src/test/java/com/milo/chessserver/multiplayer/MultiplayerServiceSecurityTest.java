package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.GameType;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.multiplayer.AcceptDrawRequest;
import com.milo.chessdomain.multiplayer.HelloAck;
import com.milo.chessdomain.multiplayer.HelloAuthRequest;
import com.milo.chessdomain.multiplayer.MakeMoveRequest;
import com.milo.chessdomain.multiplayer.ResignRequest;
import com.milo.chessserver.multiplayer.WsEvent;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessserver.game.GameEntity;
import com.milo.chessserver.game.GamePlayerEntity;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.game.GameService;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import com.milo.chessengine.ChessEngine;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MultiplayerServiceSecurityTest {
    private static final String SESSION = "ws-client";

    @Test
    void nonPlayerCannotMoveAndDoesNotReceiveTheGameSnapshot() {
        Fixture fixture = fixture();
        MoveDto requested = new MoveDto("e2", "e4", null, Color.WHITE);
        when(fixture.players.findByGameIdAndUserId(fixture.game.getId(), fixture.user.getId())).thenReturn(null);

        fixture.service.makeMove(SESSION, new MakeMoveRequest(fixture.game.getId(), requested));

        verify(fixture.gameService, never()).applyMultiplayerMove(any(UUID.class), any(MoveDto.class), any(), any());
        verify(fixture.games, never()).save(any(GameEntity.class));
        WsEvent rejection = lastUserEvent(fixture.messaging);
        assertEquals("commandRejected", rejection.type());
        assertEquals("not_a_player", rejection.payload());
    }

    @Test
    void movesAfterCheckmateOrResignationAreRejectedWithoutMutation() {
        for (GameEndReason endReason : List.of(GameEndReason.CHECKMATE, GameEndReason.RESIGNATION)) {
            Fixture fixture = fixture();
            fixture.game.setResult(GameResult.WHITE_WIN);
            fixture.game.setEndReason(endReason);
            GamePlayerEntity player = new GamePlayerEntity();
            player.setGame(fixture.game);
            player.setUser(fixture.user);
            player.setColor(Color.WHITE);
            when(fixture.players.findByGameIdAndUserId(fixture.game.getId(), fixture.user.getId())).thenReturn(player);

            fixture.service.makeMove(SESSION, new MakeMoveRequest(fixture.game.getId(),
                    new MoveDto("e2", "e4", null, Color.WHITE)));

            verify(fixture.gameService, never()).applyMultiplayerMove(any(UUID.class), any(MoveDto.class), any(), any());
            verify(fixture.games, never()).save(any(GameEntity.class));
            assertEquals(endReason, fixture.game.getEndReason());
        }
    }

    @Test
    void resignationAfterTheActiveClockExpiresEndsByTimeout() {
        Fixture fixture = fixture();
        fixture.game.setTimeControlType(TimeControlType.BLITZ);
        fixture.game.setWhiteTimeLeftMs(1L);
        fixture.game.setBlackTimeLeftMs(10_000L);
        fixture.game.setStartedAt(Instant.now().minusSeconds(2));
        fixture.game.setLastMoveAt(Instant.now().minusSeconds(2));
        GamePlayerEntity player = new GamePlayerEntity();
        player.setGame(fixture.game);
        player.setUser(fixture.user);
        player.setColor(Color.WHITE);
        when(fixture.players.findByGameIdAndUserId(fixture.game.getId(), fixture.user.getId())).thenReturn(player);

        fixture.service.resign(SESSION, new ResignRequest(fixture.game.getId()));

        assertEquals(GameResult.BLACK_WIN, fixture.game.getResult());
        assertEquals(GameEndReason.TIME_OUT, fixture.game.getEndReason());
    }

    @Test
    void spectatorCannotAcceptDrawWithoutAnOpponentOffer() {
        Fixture fixture = fixture();
        when(fixture.players.findByGameIdAndUserId(fixture.game.getId(), fixture.user.getId())).thenReturn(null);

        fixture.service.acceptDraw(SESSION, new AcceptDrawRequest(fixture.game.getId(), fixture.game.getCurrentFen(),
                Color.WHITE, 600_000, 600_000));

        verify(fixture.games, never()).save(any(GameEntity.class));
        WsEvent rejection = lastUserEvent(fixture.messaging);
        assertEquals("commandRejected", rejection.type());
        assertEquals("not_a_player", rejection.payload());
    }

    @Test
    void validReconnectRotatesTokenAndOldTokenCannotBeReplayed() {
        Fixture fixture = fixture();
        when(fixture.sessions.getUser(SESSION)).thenReturn(null);
        GamePlayerEntity player = new GamePlayerEntity();
        player.setGame(fixture.game);
        player.setUser(fixture.user);
        player.setColor(Color.WHITE);
        player.setReconnectToken("old-token");
        when(fixture.players.findByReconnectToken("old-token")).thenReturn(Optional.of(player));
        AtomicInteger tokenLookups = new AtomicInteger();
        when(fixture.players.findByReconnectTokenForUpdate(anyString())).thenAnswer(invocation ->
                tokenLookups.getAndIncrement() == 0 ? Optional.of(player) : Optional.empty());
        when(fixture.players.findByGameIdAndUserId(fixture.game.getId(), fixture.user.getId())).thenReturn(player);
        when(fixture.gameService.loadMoves(fixture.game.getId())).thenReturn(List.of());
        when(fixture.sessions.getSessionId(fixture.user.getId())).thenReturn(SESSION);

        fixture.service.handleHello(SESSION, new HelloAuthRequest("ignored-name", "old-token"));
        String rotatedToken = player.getReconnectToken();
        assertNotEquals("old-token", rotatedToken);
        assertEquals(43, rotatedToken.length());
        verify(fixture.sessions).bindReconnectUser(SESSION, fixture.user);
        assertTrue(userEvents(fixture.messaging).stream().anyMatch(event ->
                event.type().equals("helloAck")
                        && ((HelloAck) event.payload()).reconnectToken().equals(rotatedToken)));

        fixture.service.handleHello("replay-socket", new HelloAuthRequest("alice", "old-token"));
        verify(fixture.sessions, times(1)).bindReconnectUser(anyString(), any(UserEntity.class));
        verify(fixture.sessions, never()).registerGuestSession(anyString(), anyString());
        assertTrue(userEvents(fixture.messaging).stream().anyMatch(event ->
                event.type().equals("helloFailed") && event.payload().equals("invalid_reconnect_token")));
    }

    @Test
    void invalidReconnectTokenCannotFallBackToANameBasedGuestIdentity() {
        Fixture fixture = fixture();
        when(fixture.sessions.getUser(SESSION)).thenReturn(null);
        when(fixture.players.findByReconnectTokenForUpdate("invalid")).thenReturn(Optional.empty());

        fixture.service.handleHello(SESSION, new HelloAuthRequest("registered-name", "invalid"));

        verify(fixture.sessions, never()).registerGuestSession(anyString(), anyString());
        verify(fixture.sessions, never()).bindReconnectUser(anyString(), any(UserEntity.class));
        assertEquals("helloFailed", lastUserEvent(fixture.messaging).type());
    }

    private Fixture fixture() {
        SimpMessagingTemplate messaging = mock(SimpMessagingTemplate.class);
        GameRepository games = mock(GameRepository.class);
        GamePlayerRepository players = mock(GamePlayerRepository.class);
        UserRepository users = mock(UserRepository.class);
        GameService gameService = mock(GameService.class);
        ClockService clocks = new ClockService();
        MatchmakingService matchmaking = new MatchmakingService(new BCryptPasswordEncoder());
        RoomService rooms = mock(RoomService.class);
        SessionService sessions = mock(SessionService.class);
        ChessEngine engine = mock(ChessEngine.class);
        MultiplayerService service = new MultiplayerService(messaging, games, players, users, gameService,
                clocks, matchmaking, rooms, sessions, engine, 120_000, false, 1600, 12, 200, 3);

        UserEntity user = new UserEntity();
        user.setUsername("internal-alice");
        user.setDisplayName("Alice");
        ReflectionTestUtils.setField(user, "id", 71L);
        GameEntity game = new GameEntity();
        game.setId(UUID.randomUUID());
        game.setGameType(GameType.VS_HUMAN);
        game.setResult(GameResult.ONGOING);
        game.setTimeControlType(TimeControlType.RAPID);
        game.setCurrentFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        game.setSideToMove(Color.WHITE);
        when(sessions.getUser(SESSION)).thenReturn(user);
        when(games.findById(game.getId())).thenReturn(Optional.of(game));
        when(games.findLockedById(game.getId())).thenReturn(Optional.of(game));
        return new Fixture(service, messaging, games, players, gameService, sessions, user, game);
    }

    private WsEvent lastUserEvent(SimpMessagingTemplate messaging) {
        List<WsEvent> events = userEvents(messaging);
        return events.get(events.size() - 1);
    }

    private List<WsEvent> userEvents(SimpMessagingTemplate messaging) {
        org.mockito.ArgumentCaptor<Object> captor = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeastOnce()).convertAndSendToUser(anyString(), eq("/queue/game"), captor.capture());
        return captor.getAllValues().stream().map(WsEvent.class::cast).toList();
    }

    private record Fixture(MultiplayerService service,
                           SimpMessagingTemplate messaging,
                           GameRepository games,
                           GamePlayerRepository players,
                           GameService gameService,
                           SessionService sessions,
                           UserEntity user,
                           GameEntity game) {}
}
