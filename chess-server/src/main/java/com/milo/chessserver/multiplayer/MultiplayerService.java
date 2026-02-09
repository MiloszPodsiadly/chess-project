package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.*;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessdomain.game.EngineMoveResponseDto;
import com.milo.chessdomain.multiplayer.*;
import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.Position;
import com.milo.chessserver.game.*;
import com.milo.chessserver.game.AnalysisMapper;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;

@Service
public class MultiplayerService {

    private static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    private static final Logger log = LoggerFactory.getLogger(MultiplayerService.class);

    private final SimpMessagingTemplate messaging;
    private final GameRepository gameRepository;
    private final GamePlayerRepository playerRepository;
    private final UserRepository userRepository;
    private final GameService gameService;
    private final ClockService clockService;
    private final SessionService sessionService;
    private final MatchmakingService matchmakingService;
    private final RoomService roomService;
    private final SecureRandom random = new SecureRandom();
    private final Map<UUID, Map<Long, Integer>> drawOfferCounts = new java.util.concurrent.ConcurrentHashMap<>();
    private final long reconnectTimeoutMs;
    private final ChessEngine chessEngine;
    private final boolean analysisEnabled;
    private final int analysisElo;
    private final int analysisDepth;
    private final long analysisTimeMs;
    private final int analysisMaxLines;

    public MultiplayerService(SimpMessagingTemplate messaging,
                              GameRepository gameRepository,
                              GamePlayerRepository playerRepository,
                              UserRepository userRepository,
                              GameService gameService,
                              ClockService clockService,
                              MatchmakingService matchmakingService,
                              RoomService roomService,
                              SessionService sessionService,
                              ChessEngine chessEngine,
                              @Value("${chess.multiplayer.reconnect-timeout-ms:120000}") long reconnectTimeoutMs,
                              @Value("${chess.analysis.enabled:false}") boolean analysisEnabled,
                              @Value("${chess.analysis.elo:1600}") int analysisElo,
                              @Value("${chess.analysis.depth:12}") int analysisDepth,
                              @Value("${chess.analysis.time-ms:200}") long analysisTimeMs,
                              @Value("${chess.analysis.max-lines:3}") int analysisMaxLines) {
        this.messaging = messaging;
        this.gameRepository = gameRepository;
        this.playerRepository = playerRepository;
        this.userRepository = userRepository;
        this.gameService = gameService;
        this.clockService = clockService;
        this.matchmakingService = matchmakingService;
        this.roomService = roomService;
        this.sessionService = sessionService;
        this.chessEngine = chessEngine;
        this.reconnectTimeoutMs = reconnectTimeoutMs;
        this.analysisEnabled = analysisEnabled;
        this.analysisElo = analysisElo;
        this.analysisDepth = analysisDepth;
        this.analysisTimeMs = analysisTimeMs;
        this.analysisMaxLines = analysisMaxLines;
    }

    public void handleHello(String sessionKey, HelloAuthRequest request) {
        if (request != null && request.reconnectToken() != null && !request.reconnectToken().isBlank()) {
            GamePlayerEntity player = playerRepository.findByReconnectToken(request.reconnectToken());
            if (player != null) {
                UserEntity user = player.getUser();
                if (user != null) {
                    player.setLastSeenAt(Instant.now());
                    playerRepository.save(player);
                    sessionService.bindReconnectUser(sessionKey, user);
                    sessionService.attachGame(user.getId(), player.getGame().getId());
                    sendOpponentReconnected(player.getGame().getId());
                    sendSyncToUser(user.getId(), player.getGame().getId());
                    sendEventToUser(sessionKey, new WsEvent("helloAck", new HelloAck(user.getUsername())));
                    return;
                }
            }
        }
        UserEntity user = sessionService.registerSession(sessionKey, request == null ? null : request.username());
        log.info("Session registered: sessionKey={}, username={}", sessionKey, request != null ? request.username() : null);
        sendEventToUser(sessionKey, new WsEvent("helloAck", new HelloAck(user.getUsername())));
        sendPublicRooms(sessionKey);
    }

    public String createRoom(String sessionKey, CreateRoomRequest request) {
        UserEntity host = sessionService.getUser(sessionKey);
        if (host == null) {
            log.warn("Create room: no session user for sessionKey={}, auto-registering guest", sessionKey);
            sessionService.registerSession(sessionKey, null);
            host = sessionService.getUser(sessionKey);
        }
        if (host == null) {
            sendEventToUser(sessionKey, new WsEvent("roomCreateFailed", "not_authenticated"));
            return null;
        }
        if (hasActiveGame(host)) {
            log.warn("Create room denied: active game for userId={}", host.getId());
            sendEventToUser(sessionKey, new WsEvent("roomCreateFailed", "active_game"));
            return null;
        }
        String code = generateRoomCode();
        RoomService.CreateRoomResult result = roomService.createRoom(host, request, code);
        if (result.error() != null) {
            sendEventToUser(sessionKey, new WsEvent("roomCreateFailed", result.error()));
            return null;
        }
        RoomParticipantsDto participants = roomService.roomParticipants(result.room().getRoomCode());
        if (participants != null) {
            sendEventToUser(sessionKey, new WsEvent("roomParticipants", participants));
        }
        broadcastPublicRooms();
        return result.room() != null ? result.room().getRoomCode() : null;
    }

    @Transactional
    public void joinRoom(String sessionKey, JoinRoomRequest request) {
        UserEntity guest = sessionService.getUser(sessionKey);
        if (guest == null || request == null || request.roomCode() == null) {
            if (request != null && request.roomCode() != null) {
                sessionService.registerSession(sessionKey, null);
                guest = sessionService.getUser(sessionKey);
            }
            if (guest == null || request == null || request.roomCode() == null) {
                return;
            }
        }
        if (hasActiveGame(guest)) {
            sendEventToUser(sessionKey, new WsEvent("roomJoinFailed", "active_game"));
            return;
        }
        RoomService.JoinRoomResult join = roomService.joinRoom(guest, request);
        if (join.room() == null) {
            sendEventToUser(sessionKey, new WsEvent("roomJoinFailed", join.error() != null ? join.error() : "room_join_failed"));
            return;
        }
        RoomParticipantsDto participants = roomService.roomParticipants(join.room().getRoomCode());
        if (participants != null) {
            messaging.convertAndSend("/topic/room/" + participants.roomCode(), new WsEvent("roomParticipants", participants));
        }
        broadcastPublicRooms();
    }

    @Transactional
    public void queueMatchmaking(String sessionKey, QueueMatchmakingRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null) {
            sessionService.registerSession(sessionKey, null);
            user = sessionService.getUser(sessionKey);
            if (user == null) {
                return;
            }
        }
        if (hasActiveGame(user)) {
            sendEventToUser(sessionKey, new WsEvent("matchmakingFailed", "active_game"));
            return;
        }
        TimeControlType type = request == null ? TimeControlType.RAPID : request.timeControlType();
        MatchmakingService.QueueEntry other = matchmakingService.enqueue(type, new MatchmakingService.QueueEntry(user.getId(), type, Instant.now()));
        if (other != null) {
            createAndStartGame(type, other.userId(), user.getId(), null);
        }
    }

    @Transactional
    public void makeMove(String sessionKey, MakeMoveRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.gameId() == null || request.move() == null) {
            return;
        }
        GameEntity game = gameRepository.findById(request.gameId()).orElse(null);
        if (game == null || game.getResult() != GameResult.ONGOING) {
            return;
        }
        GamePlayerEntity player = playerRepository.findByGameIdAndUserId(game.getId(), user.getId());
        if (player == null) {
            sendMoveRejected(game, "not_a_player");
            return;
        }
        player.setLastSeenAt(Instant.now());
        playerRepository.save(player);
        Color playerColor = player.getColor();
        if (playerColor != game.getSideToMove()) {
            sendMoveRejected(game, "not_your_turn");
            return;
        }

        try {
            game = gameService.applyMove(game.getId(), request.move());
        } catch (IllegalArgumentException ex) {
            sendMoveRejected(game, "illegal_move");
            return;
        }

        sendMoveAccepted(game, request.move());

        if (game.getResult() != GameResult.ONGOING) {
            sendGameEnded(game.getId(), game.getResult(), game.getEndReason());
        }
    }

    @Transactional
    public void resign(String sessionKey, ResignRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null) {
            return;
        }
        GameEntity game = gameRepository.findById(request.gameId()).orElse(null);
        if (game == null || game.getResult() != GameResult.ONGOING) {
            return;
        }
        GamePlayerEntity player = playerRepository.findByGameIdAndUserId(game.getId(), user.getId());
        if (player == null) {
            return;
        }
        if (player.getColor() == Color.WHITE) {
            game.setResult(GameResult.BLACK_WIN);
        } else {
            game.setResult(GameResult.WHITE_WIN);
        }
        game.setEndReason(GameEndReason.RESIGNATION);
        game.setFinishedAt(Instant.now());
        gameRepository.save(game);
        sendGameEnded(game.getId(), game.getResult(), game.getEndReason());
    }

    public void offerDraw(String sessionKey, OfferDrawRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null) {
            return;
        }
        GameEntity game = gameRepository.findById(request.gameId()).orElse(null);
        if (game == null) {
            return;
        }
        if (isDrawOfferLimitReached(game.getId(), user.getId())) {
            sendEventToUser(sessionKey, new WsEvent("drawOfferLimit", "limit_reached"));
            return;
        }
        incrementDrawOffer(game.getId(), user.getId());
        OfferDrawRequest payload = new OfferDrawRequest(
                game.getId(),
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs()
        );
        sendToOpponent(user.getId(), game.getId(), new WsEvent("offerDraw", payload));
    }

    @Transactional
    public void acceptDraw(String sessionKey, AcceptDrawRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null) {
            return;
        }
        GameEntity game = gameRepository.findById(request.gameId()).orElse(null);
        if (game == null || game.getResult() != GameResult.ONGOING) {
            return;
        }
        AcceptDrawRequest payload = new AcceptDrawRequest(
                game.getId(),
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs()
        );
        game.setResult(GameResult.DRAW);
        game.setEndReason(GameEndReason.AGREED_DRAW);
        game.setFinishedAt(Instant.now());
        gameRepository.save(game);
        sendEvent(game.getId(), "acceptDraw", payload);
        sendGameEnded(game.getId(), game.getResult(), game.getEndReason());
    }

    public void declineDraw(String sessionKey, DeclineDrawRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.gameId() == null) {
            return;
        }
        sendToOpponent(user.getId(), request.gameId(), new WsEvent("drawDeclined", request.gameId()));
    }

    public void requestSync(String sessionKey, RequestSyncRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null) {
            return;
        }
        UUID gameId = request.gameId() != null ? request.gameId() : sessionService.getActiveGame(user.getId());
        sendSyncToUser(user.getId(), gameId);
    }

    public void listRooms(String sessionKey) {
        sendPublicRooms(sessionKey);
    }

    public void createInvite(String sessionKey, CreateInviteRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null) {
            return;
        }
        RoomInviteDto invite = roomService.createInvite(user, request);
        if (invite == null) {
            sendEventToUser(sessionKey, new WsEvent("roomInviteFailed", "invite_failed"));
            return;
        }
        sendEventToUser(sessionKey, new WsEvent("roomInviteCreated", invite));
    }

    public void sendRoomMessage(String sessionKey, SendRoomMessageRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null) {
            return;
        }
        RoomMessageDto message = roomService.addMessage(user, request);
        if (message == null) {
            return;
        }
        messaging.convertAndSend("/topic/room/" + message.roomCode(), new WsEvent("roomMessage", message));
    }

    public void roomHistory(String sessionKey, RoomHistoryRequest request) {
        if (request == null || request.roomCode() == null) {
            return;
        }
        List<RoomMessageDto> history = roomService.roomHistory(request.roomCode());
        sendEventToUser(sessionKey, new WsEvent("roomHistory", history));
    }

    public void leaveRoom(String sessionKey, LeaveRoomRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null) {
            return;
        }
        roomService.leaveRoom(user, request.roomCode());
        RoomParticipantsDto participants = roomService.roomParticipants(request.roomCode());
        if (participants != null) {
            messaging.convertAndSend("/topic/room/" + participants.roomCode(), new WsEvent("roomParticipants", participants));
        }
        broadcastPublicRooms();
    }

    public void roomParticipants(String sessionKey, RoomParticipantsRequest request) {
        if (request == null || request.roomCode() == null) {
            return;
        }
        RoomParticipantsDto participants = roomService.roomParticipants(request.roomCode());
        if (participants == null) {
            return;
        }
        sendEventToUser(sessionKey, new WsEvent("roomParticipants", participants));
    }

    public void kickPlayer(String sessionKey, KickPlayerRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null || request.username() == null) {
            return;
        }
        RoomService.KickResult result = roomService.kickPlayer(user, request.roomCode(), request.username());
        if (result.error() != null) {
            sendEventToUser(sessionKey, new WsEvent("roomKickFailed", result.error()));
            return;
        }
        RoomParticipantsDto participants = roomService.roomParticipants(request.roomCode());
        if (participants != null) {
            messaging.convertAndSend("/topic/room/" + participants.roomCode(), new WsEvent("roomParticipants", participants));
        }
        if (result.user() != null) {
            String targetSession = sessionService.getSessionId(result.user().getId());
            if (targetSession != null) {
                messaging.convertAndSendToUser(targetSession, "/queue/game", new WsEvent("roomKicked", request.roomCode()));
            }
        }
        broadcastPublicRooms();
    }

    public void deleteRoom(String sessionKey, DeleteRoomRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null) {
            return;
        }
        boolean deleted = roomService.deleteRoom(user, request.roomCode());
        if (!deleted) {
            sendEventToUser(sessionKey, new WsEvent("roomDeleteFailed", "delete_failed"));
            return;
        }
        messaging.convertAndSend("/topic/room/" + request.roomCode(), new WsEvent("roomClosed", request.roomCode()));
        sendEventToUser(sessionKey, new WsEvent("roomDeleted", request.roomCode()));
        broadcastPublicRooms();
    }

    public void startRoomGame(String sessionKey, StartRoomGameRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null) {
            return;
        }
        RoomService.StartGameResult result = roomService.startGame(user, request.roomCode());
        if (result.error() != null || result.room() == null || result.guest() == null) {
            log.warn("Start room failed: sessionKey={}, roomCode={}, error={}", sessionKey, request.roomCode(),
                    result != null ? result.error() : "unknown");
            sendEventToUser(sessionKey, new WsEvent("roomStartFailed", result.error() != null ? result.error() : "start_failed"));
            return;
        }
        log.info("Start room success: roomCode={}, hostId={}, guestId={}", result.room().getRoomCode(), user.getId(), result.guest().getId());
        createAndStartGame(result.room(), result.guest().getId());
        broadcastPublicRooms();
    }

    public void spectateRoom(String sessionKey, SpectateRoomRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null) {
            return;
        }
        RoomService.JoinRoomResult join = roomService.spectateRoom(user, request);
        if (join.room() == null) {
            sendEventToUser(sessionKey, new WsEvent("roomSpectateFailed", join.error()));
            return;
        }
        RoomEntity room = join.room();
        if (room.getGameId() != null) {
            sendSyncToUser(user.getId(), room.getGameId());
        }
    }

    public void handleDisconnect(String sessionKey) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null) {
            sessionService.clearSession(sessionKey);
            return;
        }
        List<String> updatedRooms = roomService.handleDisconnect(user);
        broadcastPublicRooms();
        for (String roomCode : updatedRooms) {
            RoomParticipantsDto participants = roomService.roomParticipants(roomCode);
            if (participants != null) {
                messaging.convertAndSend("/topic/room/" + participants.roomCode(), new WsEvent("roomParticipants", participants));
            }
        }
        UUID gameId = sessionService.getActiveGame(user.getId());
        if (gameId != null) {
            GamePlayerEntity player = playerRepository.findByGameIdAndUserId(gameId, user.getId());
            if (player != null) {
                player.setLastSeenAt(Instant.now());
                playerRepository.save(player);
            }
        }
        if (gameId != null) {
            sendOpponentDisconnected(gameId);
        }
        sessionService.clearSession(sessionKey);
    }

    public void handleReconnectTimeouts(java.time.Duration timeout) {
        List<GameEntity> ongoing = gameRepository.findByResult(GameResult.ONGOING);
        Instant now = Instant.now();
        for (GameEntity game : ongoing) {
            List<GamePlayerEntity> players = playerRepository.findByGameId(game.getId());
            if (players.size() != 2) {
                continue;
            }
            GamePlayerEntity p1 = players.get(0);
            GamePlayerEntity p2 = players.get(1);
            boolean p1Timeout = java.time.Duration.between(p1.getLastSeenAt(), now).compareTo(timeout) > 0;
            boolean p2Timeout = java.time.Duration.between(p2.getLastSeenAt(), now).compareTo(timeout) > 0;
            if (p1Timeout && p2Timeout) {
                if (game.getResult() == GameResult.ONGOING) {
                    game.setResult(GameResult.DRAW);
                    game.setEndReason(GameEndReason.TIME_OUT);
                    game.setFinishedAt(now);
                    gameRepository.save(game);
                    sendGameEnded(game.getId(), game.getResult(), game.getEndReason());
                }
            } else if (p1Timeout) {
                endGameForDisconnect(game, p2.getColor());
            } else if (p2Timeout) {
                endGameForDisconnect(game, p1.getColor());
            }
        }
    }

    public void handleClockTimeouts() {
        List<GameEntity> ongoing = gameRepository.findByResult(GameResult.ONGOING);
        Instant now = Instant.now();
        for (GameEntity game : ongoing) {
            if (game.getTimeControlType() == TimeControlType.UNTIMED) {
                continue;
            }
            Color toMove = game.getSideToMove();
            long remaining = clockService.remainingAfterTick(game, toMove, now);
            if (remaining > 0L) {
                continue;
            }
            if (toMove == Color.WHITE) {
                game.setWhiteTimeLeftMs(0L);
                game.setResult(GameResult.BLACK_WIN);
            } else {
                game.setBlackTimeLeftMs(0L);
                game.setResult(GameResult.WHITE_WIN);
            }
            game.setEndReason(GameEndReason.TIME_OUT);
            game.setFinishedAt(now);
            game.setLastMoveAt(now);
            gameRepository.save(game);
            sendGameEnded(game.getId(), game.getResult(), game.getEndReason());
        }
    }

    public long reconnectTimeoutMs() {
        return reconnectTimeoutMs;
    }

    private void endGameForDisconnect(GameEntity game, Color winner) {
        if (game.getResult() != GameResult.ONGOING) {
            return;
        }
        game.setResult(winner == Color.WHITE ? GameResult.WHITE_WIN : GameResult.BLACK_WIN);
        game.setEndReason(GameEndReason.TIME_OUT);
        game.setFinishedAt(Instant.now());
        gameRepository.save(game);
        sendGameEnded(game.getId(), game.getResult(), game.getEndReason());
    }

    private void createAndStartGame(TimeControlType type, Long whiteUserId, Long blackUserId, RoomEntity room) {
        boolean swap = random.nextBoolean();
        Long whiteId = swap ? blackUserId : whiteUserId;
        Long blackId = swap ? whiteUserId : blackUserId;

        UserEntity white = userRepository.findById(whiteId).orElseThrow();
        UserEntity black = userRepository.findById(blackId).orElseThrow();

        GameEntity game = new GameEntity();
        game.setId(UUID.randomUUID());
        game.setGameType(GameType.VS_HUMAN);
        game.setVariant(GameVariant.STANDARD);
        game.setSideToMove(Color.WHITE);
        game.setCurrentFen(START_FEN);
        game.setTimeControlType(type);
        game.setStartedAt(Instant.now());
        game.setWhitePlayer(white);
        game.setBlackPlayer(black);
        long initial = clockService.initialTimeMs(type);
        game.setWhiteTimeLeftMs(initial);
        game.setBlackTimeLeftMs(initial);
        game.setLastMoveAt(game.getStartedAt());
        gameRepository.save(game);

        GamePlayerEntity whitePlayer = createGamePlayer(game, white, Color.WHITE, type);
        GamePlayerEntity blackPlayer = createGamePlayer(game, black, Color.BLACK, type);
        playerRepository.save(whitePlayer);
        playerRepository.save(blackPlayer);

        sessionService.attachGame(white.getId(), game.getId());
        sessionService.attachGame(black.getId(), game.getId());

        sendGameStarted(game, white.getId(), whitePlayer.getReconnectToken(), Color.WHITE);
        sendGameStarted(game, black.getId(), blackPlayer.getReconnectToken(), Color.BLACK);
        sendSyncToUser(white.getId(), game.getId());
        sendSyncToUser(black.getId(), game.getId());

        if (room != null) {
            roomService.markRoomInGame(room, game.getId());
        }
    }

    private void createAndStartGame(RoomEntity room, Long guestUserId) {
        Long hostId = room.getHostUser() != null ? room.getHostUser().getId() : null;
        if (hostId == null) {
            return;
        }
        createAndStartGame(room.getTimeControlType(), hostId, guestUserId, room);
    }

    private GamePlayerEntity createGamePlayer(GameEntity game, UserEntity user, Color color, TimeControlType type) {
        GamePlayerEntity player = new GamePlayerEntity();
        player.setGame(game);
        player.setUser(user);
        player.setColor(color);
        player.setPlayerType(PlayerType.HUMAN);
        player.setRatingAtStart(ratingFor(user, type));
        player.setReconnectToken(UUID.randomUUID().toString().replace("-", ""));
        return player;
    }

    private int ratingFor(UserEntity user, TimeControlType type) {
        return switch (type) {
            case BLITZ, BULLET -> user.getRatingBlitz();
            case RAPID, CLASSICAL -> user.getRatingRapid();
            case UNTIMED -> user.getRatingRapid();
        };
    }

    private void sendMoveAccepted(GameEntity game, MoveDto move) {
        EngineMoveResponseDto analysis = analysisEnabled ? analysePosition(game) : null;
        MoveAcceptedEvent event = new MoveAcceptedEvent(
                game.getId(),
                move,
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs(),
                game.getLastMoveAt(),
                analysis
        );
        sendEvent(game.getId(), "moveAccepted", event);
    }

    private void sendMoveRejected(GameEntity game, String reason) {
        if (game == null) {
            return;
        }
        MoveRejectedEvent event = new MoveRejectedEvent(
                game.getId(),
                reason,
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs()
        );
        sendEvent(game.getId(), "moveRejected", event);
    }

    private void sendGameStarted(GameEntity game, Long userId, String reconnectToken, Color yourColor) {
        String roomCode = roomService.findRoomCodeByGame(game.getId());
        GameStartedEvent event = new GameStartedEvent(
                game.getId(),
                yourColor,
                game.getSideToMove(),
                game.getCurrentFen(),
                game.getTimeControlType(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs(),
                game.getLastMoveAt(),
                reconnectToken,
                roomCode
        );
        String sessionId = sessionService.getSessionId(userId);
        if (sessionId != null) {
            messaging.convertAndSendToUser(sessionId, "/queue/game", new WsEvent("gameStarted", event));
        }
    }

    private void sendGameEnded(UUID gameId, GameResult result, GameEndReason reason) {
        GameEntity game = gameRepository.findById(gameId).orElse(null);
        if (game == null) {
            return;
        }
        drawOfferCounts.remove(gameId);
        List<GamePlayerEntity> players = playerRepository.findByGameId(gameId);
        for (GamePlayerEntity player : players) {
            if (player.getUser() != null) {
                sessionService.detachGame(player.getUser().getId());
            }
        }
        roomService.closeRoomByGame(gameId);
        broadcastPublicRooms();
        GameEndedEvent event = new GameEndedEvent(
                gameId,
                result,
                reason,
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs()
        );
        sendEvent(gameId, "gameEnded", event);
    }

    private void sendOpponentDisconnected(UUID gameId) {
        sendEvent(gameId, "opponentDisconnected", new OpponentDisconnectedEvent(gameId));
    }

    private void sendOpponentReconnected(UUID gameId) {
        sendEvent(gameId, "opponentReconnected", new OpponentReconnectedEvent(gameId));
    }

    private void sendToOpponent(Long userId, UUID gameId, WsEvent event) {
        List<GamePlayerEntity> players = playerRepository.findByGameId(gameId);
        for (GamePlayerEntity player : players) {
            if (player.getUser() == null || player.getUser().getId().equals(userId)) {
                continue;
            }
            String sessionId = sessionService.getSessionId(player.getUser().getId());
            if (sessionId != null) {
                messaging.convertAndSendToUser(sessionId, "/queue/game", event);
            }
        }
    }

    private boolean isDrawOfferLimitReached(UUID gameId, Long userId) {
        if (gameId == null || userId == null) {
            return true;
        }
        Map<Long, Integer> counts = drawOfferCounts.get(gameId);
        if (counts == null) {
            return false;
        }
        return counts.getOrDefault(userId, 0) >= 2;
    }

    private void incrementDrawOffer(UUID gameId, Long userId) {
        drawOfferCounts.computeIfAbsent(gameId, key -> new java.util.concurrent.ConcurrentHashMap<>())
                .merge(userId, 1, Integer::sum);
    }

    private void sendSyncToUser(Long userId, UUID gameId) {
        if (gameId == null) {
            return;
        }
        GameEntity game = gameRepository.findById(gameId).orElse(null);
        if (game == null) {
            return;
        }
        GamePlayerEntity player = playerRepository.findByGameIdAndUserId(gameId, userId);
        Color yourColor = player != null ? player.getColor() : null;
        String roomCode = roomService.findRoomCodeByGame(gameId);
        List<GameMoveEntity> moves = gameService.loadMoves(gameId);
        List<MoveDto> moveDtos = moves.stream()
                .map(m -> new MoveDto(m.getFromSquare(), m.getToSquare(), m.getPromotion(), m.getPlayerColor()))
                .toList();
        GameStateSyncDto state = new GameStateSyncDto(
                game.getId(),
                game.getCurrentFen(),
                game.getSideToMove(),
                yourColor,
                roomCode,
                game.getResult(),
                game.getEndReason(),
                moveDtos,
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs(),
                game.getLastMoveAt(),
                analysisEnabled ? analysePosition(game) : null
        );
        String sessionId = sessionService.getSessionId(userId);
        if (sessionId != null) {
            messaging.convertAndSendToUser(sessionId, "/queue/game", new WsEvent("gameStateSync", new GameStateSyncEvent(state)));
        }
    }

    private void sendEvent(UUID gameId, String type, Object payload) {
        messaging.convertAndSend("/topic/game/" + gameId, new WsEvent(type, payload));
    }

    public void sendEventToUser(String sessionKey, WsEvent event) {
        messaging.convertAndSendToUser(sessionKey, "/queue/game", event);
    }

    public void sendPublicRooms(String sessionKey) {
        List<com.milo.chessdomain.multiplayer.PublicRoomDto> rooms = roomService.listPublicRooms();
        sendEventToUser(sessionKey, new WsEvent("publicRooms", rooms));
    }

    public void broadcastPublicRooms() {
        List<com.milo.chessdomain.multiplayer.PublicRoomDto> rooms = roomService.listPublicRooms();
        messaging.convertAndSend("/topic/lobby", new WsEvent("publicRooms", rooms));
    }

    private EngineMoveResponseDto analysePosition(GameEntity game) {
        if (game == null) {
            return null;
        }
        EngineConfig base = EngineConfigMapper.toEngineConfig(analysisElo, game.getSideToMove());
        EngineConfig config = new EngineConfig(
                analysisDepth > 0 ? analysisDepth : base.requestedDepth(),
                analysisTimeMs > 0 ? analysisTimeMs : base.hardTimeLimitMillis(),
                base.engineElo(),
                base.engineColor(),
                base.skillProfile()
        );
        EngineResult result = chessEngine.findBestMove(new Position(game.getCurrentFen(), game.getSideToMove()), config);
        return AnalysisMapper.toResponse(game.getCurrentFen(), result, analysisMaxLines);
    }

    private boolean hasActiveGame(UserEntity user) {
        UUID activeId = sessionService.getActiveGame(user.getId());
        if (activeId == null) {
            return false;
        }
        GameEntity active = gameRepository.findById(activeId).orElse(null);
        if (active == null || active.getResult() != GameResult.ONGOING) {
            sessionService.detachGame(user.getId());
            return false;
        }
        return true;
    }

    private String generateRoomCode() {
        String letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            sb.append(letters.charAt(random.nextInt(letters.length())));
        }
        return sb.toString();
    }
    
}
