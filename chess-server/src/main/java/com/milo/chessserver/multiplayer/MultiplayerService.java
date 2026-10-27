package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.*;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessdomain.game.EngineMoveResponseDto;
import com.milo.chessdomain.multiplayer.*;
import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.config.EngineStrength;
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
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
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
    private final Map<UUID, Long> pendingDrawOffers = new java.util.concurrent.ConcurrentHashMap<>();
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

    @Transactional
    public void handleHello(String sessionKey, HelloAuthRequest request) {
        if (sessionKey == null || sessionKey.isBlank() || request == null) {
            reject(sessionKey, "malformed_hello");
            return;
        }
        if (sessionService.getUser(sessionKey) != null) {
            reject(sessionKey, "already_authenticated");
            return;
        }
        String reconnectToken = request.reconnectToken();
        if (reconnectToken != null && !reconnectToken.isBlank()) {
            if (reconnectToken.length() > 64) {
                sendEventToUser(sessionKey, new WsEvent("helloFailed", "invalid_reconnect_token"));
                return;
            }
            GamePlayerEntity candidate = playerRepository.findByReconnectToken(reconnectToken).orElse(null);
            UUID candidateGameId = candidate == null || candidate.getGame() == null
                    ? null : candidate.getGame().getId();
            GameEntity game = candidateGameId == null
                    ? null : gameRepository.findLockedById(candidateGameId).orElse(null);
            GamePlayerEntity player = game == null
                    ? null : playerRepository.findByReconnectTokenForUpdate(reconnectToken).orElse(null);
            UserEntity user = player == null ? null : player.getUser();
            if (player == null || !Objects.equals(player.getId(), candidate.getId())
                    || user == null || !Objects.equals(player.getGame().getId(), game.getId())
                    || game.getGameType() != GameType.VS_HUMAN) {
                sendEventToUser(sessionKey, new WsEvent("helloFailed", "invalid_reconnect_token"));
                return;
            }

            String rotatedToken = SecureTokenGenerator.generate();
            player.setReconnectToken(rotatedToken);
            player.setLastSeenAt(Instant.now());
            playerRepository.save(player);
            UUID gameId = game.getId();
            Long userId = user.getId();
            String displayName = user.getDisplayName();
            boolean ongoingGame = game.getResult() == GameResult.ONGOING;
            afterCommit(() -> {
                sessionService.bindReconnectUser(sessionKey, user);
                sessionService.attachGame(userId, gameId);
                if (ongoingGame) {
                    sendOpponentReconnected(gameId);
                }
                sendSyncToUser(userId, gameId);
                if (ongoingGame && !hasConnectedOpponent(userId, gameId)) {
                    sendEventToUser(sessionKey,
                            new WsEvent("opponentDisconnected", new OpponentDisconnectedEvent(gameId)));
                }
                sendEventToUser(sessionKey, new WsEvent("helloAck", new HelloAck(displayName, rotatedToken, userId)));
            });
            return;
        }

        UserEntity guest = sessionService.registerGuestSession(sessionKey, request.username());
        sendEventToUser(sessionKey, new WsEvent("helloAck", new HelloAck(guest.getDisplayName(), null, guest.getId())));
        sendPublicRooms(sessionKey);
    }

    private void afterCommit(Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            action.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }

    private void afterRollback(Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status != TransactionSynchronization.STATUS_COMMITTED) {
                    action.run();
                }
            }
        });
    }

    public String createRoom(String sessionKey, CreateRoomRequest request) {
        UserEntity host = sessionService.getUser(sessionKey);
        if (host == null) {
            reject(sessionKey, "not_authenticated");
            return null;
        }
        if (request == null) {
            sendEventToUser(sessionKey, new WsEvent("roomCreateFailed", "malformed_request"));
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
        RoomParticipantsDto participants = roomService.roomParticipants(host, result.room().getRoomCode());
        if (participants != null) {
            sendEventToUser(sessionKey, new WsEvent("roomParticipants", participants));
        }
        broadcastPublicRooms();
        return result.room() != null ? result.room().getRoomCode() : null;
    }

    @Transactional
    public void joinRoom(String sessionKey, JoinRoomRequest request) {
        UserEntity guest = sessionService.getUser(sessionKey);
        if (guest == null || request == null || request.roomCode() == null || request.roomCode().isBlank()) {
            sendEventToUser(sessionKey, new WsEvent("roomJoinFailed",
                    guest == null ? "not_authenticated" : "malformed_request"));
            return;
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
        RoomParticipantsDto participants = roomService.roomParticipants(guest, join.room().getRoomCode());
        if (participants != null) {
            messaging.convertAndSend("/topic/room/" + participants.roomCode(), new WsEvent("roomParticipants", participants));
        }
        broadcastPublicRooms();
    }

    @Transactional
    public void queueMatchmaking(String sessionKey, QueueMatchmakingRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null) {
            sendEventToUser(sessionKey, new WsEvent("matchmakingFailed", "not_authenticated"));
            return;
        }
        if (request == null) {
            sendEventToUser(sessionKey, new WsEvent("matchmakingFailed", "malformed_request"));
            return;
        }
        if (hasActiveGame(user)) {
            sendEventToUser(sessionKey, new WsEvent("matchmakingFailed", "active_game"));
            return;
        }
        TimeControlType type = request.timeControlType() == null ? TimeControlType.RAPID : request.timeControlType();
        MatchmakingService.QueueEntry entry = new MatchmakingService.QueueEntry(user.getId(), type, Instant.now());
        MatchmakingService.QueueResult result = matchmakingService.enqueueOrMatch(entry, candidate -> {
            UserEntity opponentUser = userRepository.findById(candidate.userId()).orElse(null);
            return opponentUser != null
                    && sessionService.getSessionId(candidate.userId()) != null
                    && !hasActiveGame(opponentUser);
        });
        if (result.alreadyQueued()) {
            if (result.queuedEntry().timeControlType() == type) {
                sendEventToUser(sessionKey, new WsEvent("matchmakingQueued", type));
            } else {
                sendEventToUser(sessionKey, new WsEvent("matchmakingFailed", "already_queued"));
            }
            return;
        }
        if (result.matchedEntry() == null) {
            sendEventToUser(sessionKey, new WsEvent("matchmakingQueued", type));
            return;
        }

        MatchmakingService.QueueEntry opponent = result.matchedEntry();
        createAndStartGame(type, opponent.userId(), user.getId(), null);
    }

    @Transactional
    public void cancelMatchmaking(String sessionKey) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null) {
            sendEventToUser(sessionKey, new WsEvent("matchmakingFailed", "not_authenticated"));
            return;
        }
        matchmakingService.cancel(user.getId());
        sendEventToUser(sessionKey, new WsEvent("matchmakingCanceled", ""));
    }

    @Transactional
    public void makeMove(String sessionKey, MakeMoveRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.gameId() == null || request.move() == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        GameEntity game = gameRepository.findLockedById(request.gameId()).orElse(null);
        if (game == null) {
            reject(sessionKey, "game_not_found");
            return;
        }
        GamePlayerEntity player = playerRepository.findByGameIdAndUserId(game.getId(), user.getId());
        if (player == null) {
            reject(sessionKey, "not_a_player");
            return;
        }
        if (game.getResult() != GameResult.ONGOING) {
            sendMoveRejectedAfterCommit(game, "game_finished");
            return;
        }
        if (request.expectedVersion() != null && !request.expectedVersion().equals(game.getVersion())) {
            sendMoveRejectedAfterCommit(game, "stale_game_state");
            return;
        }
        if (request.move().from() == null || request.move().to() == null) {
            sendMoveRejectedAfterCommit(game, "malformed_move");
            return;
        }

        player.setLastSeenAt(Instant.now());
        playerRepository.save(player);
        Color playerColor = player.getColor();
        if (playerColor != game.getSideToMove()) {
            sendMoveRejectedAfterCommit(game, "not_your_turn");
            return;
        }

        MoveDto authoritativeMove = new MoveDto(
                request.move().from(), request.move().to(), request.move().promotion(), playerColor);
        GameService.MultiplayerMoveResult result;
        try {
            result = gameService.applyMultiplayerMove(game.getId(), authoritativeMove, playerColor, Instant.now());
        } catch (IllegalArgumentException ex) {
            sendMoveRejectedAfterCommit(game, "illegal_move");
            return;
        }
        GameEntity updated = result.game();
        if (!result.accepted()) {
            afterCommit(() -> {
                sendMoveRejected(updated, result.rejectionReason());
                if (updated.getResult() != GameResult.ONGOING) {
                    sendGameEnded(updated.getId());
                }
            });
            return;
        }
        afterCommit(() -> {
            sendMoveAccepted(updated, authoritativeMove);
            if (updated.getResult() != GameResult.ONGOING) {
                sendGameEnded(updated.getId());
            }
        });
    }

    @Transactional
    public void resign(String sessionKey, ResignRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.gameId() == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        GameEntity game = gameRepository.findLockedById(request.gameId()).orElse(null);
        if (game == null) {
            reject(sessionKey, "game_not_found");
            return;
        }
        GamePlayerEntity player = playerRepository.findByGameIdAndUserId(game.getId(), user.getId());
        if (player == null) {
            reject(sessionKey, "not_a_player");
            return;
        }
        if (game.getResult() != GameResult.ONGOING) {
            reject(sessionKey, "game_finished");
            return;
        }
        if (applyClockTimeoutIfExpired(game, Instant.now())) {
            afterCommit(() -> sendEventToUser(sessionKey,
                    new WsEvent("commandRejected", "game_finished_by_timeout")));
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
        afterCommit(() -> sendGameEnded(game.getId()));
    }

    @Transactional
    public void offerDraw(String sessionKey, OfferDrawRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.gameId() == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        GameEntity game = gameRepository.findLockedById(request.gameId()).orElse(null);
        if (game == null) {
            reject(sessionKey, "game_not_found");
            return;
        }
        if (game.getResult() != GameResult.ONGOING) {
            reject(sessionKey, "game_finished");
            return;
        }
        if (playerRepository.findByGameIdAndUserId(game.getId(), user.getId()) == null) {
            reject(sessionKey, "not_a_player");
            return;
        }
        if (applyClockTimeoutIfExpired(game, Instant.now())) {
            afterCommit(() -> sendEventToUser(sessionKey,
                    new WsEvent("commandRejected", "game_finished_by_timeout")));
            return;
        }
        if (isDrawOfferLimitReached(game.getId(), user.getId())) {
            sendEventToUser(sessionKey, new WsEvent("drawOfferLimit", "limit_reached"));
            return;
        }
        Long existingOffer = pendingDrawOffers.putIfAbsent(game.getId(), user.getId());
        if (existingOffer != null) {
            reject(sessionKey, "draw_offer_pending");
            return;
        }
        UUID gameId = game.getId();
        Long offerOwnerId = user.getId();
        afterRollback(() -> pendingDrawOffers.remove(gameId, offerOwnerId));
        OfferDrawRequest payload = new OfferDrawRequest(
                game.getId(),
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs()
        );
        afterCommit(() -> {
            incrementDrawOffer(gameId, offerOwnerId);
            sendToOpponent(offerOwnerId, gameId, new WsEvent("offerDraw", payload));
        });
    }

    @Transactional
    public void acceptDraw(String sessionKey, AcceptDrawRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.gameId() == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        GameEntity game = gameRepository.findLockedById(request.gameId()).orElse(null);
        if (game == null) {
            reject(sessionKey, "game_not_found");
            return;
        }
        if (game.getResult() != GameResult.ONGOING) {
            reject(sessionKey, "game_finished");
            return;
        }
        if (playerRepository.findByGameIdAndUserId(game.getId(), user.getId()) == null) {
            reject(sessionKey, "not_a_player");
            return;
        }
        if (applyClockTimeoutIfExpired(game, Instant.now())) {
            afterCommit(() -> sendEventToUser(sessionKey,
                    new WsEvent("commandRejected", "game_finished_by_timeout")));
            return;
        }
        Long offerOwner = pendingDrawOffers.get(game.getId());
        if (offerOwner == null || offerOwner.equals(user.getId())
                || playerRepository.findByGameIdAndUserId(game.getId(), offerOwner) == null
                || sessionService.getSessionId(offerOwner) == null
                || !pendingDrawOffers.remove(game.getId(), offerOwner)) {
            reject(sessionKey, "no_opponent_draw_offer");
            return;
        }
        UUID gameId = game.getId();
        afterRollback(() -> pendingDrawOffers.putIfAbsent(gameId, offerOwner));
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
        afterCommit(() -> {
            sendEvent(gameId, "acceptDraw", payload);
            sendGameEnded(gameId);
        });
    }

    @Transactional
    public void declineDraw(String sessionKey, DeclineDrawRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.gameId() == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        GameEntity game = gameRepository.findLockedById(request.gameId()).orElse(null);
        if (game == null) {
            reject(sessionKey, "game_not_found");
            return;
        }
        if (game.getResult() != GameResult.ONGOING) {
            reject(sessionKey, "game_finished");
            return;
        }
        if (playerRepository.findByGameIdAndUserId(game.getId(), user.getId()) == null) {
            reject(sessionKey, "not_a_player");
            return;
        }
        if (applyClockTimeoutIfExpired(game, Instant.now())) {
            afterCommit(() -> sendEventToUser(sessionKey,
                    new WsEvent("commandRejected", "game_finished_by_timeout")));
            return;
        }
        Long offerOwner = pendingDrawOffers.get(game.getId());
        if (offerOwner == null || offerOwner.equals(user.getId())
                || playerRepository.findByGameIdAndUserId(game.getId(), offerOwner) == null
                || sessionService.getSessionId(offerOwner) == null
                || !pendingDrawOffers.remove(game.getId(), offerOwner)) {
            reject(sessionKey, "no_opponent_draw_offer");
            return;
        }
        UUID gameId = game.getId();
        afterRollback(() -> pendingDrawOffers.putIfAbsent(gameId, offerOwner));
        afterCommit(() -> sendToOpponent(user.getId(), gameId, new WsEvent("drawDeclined", gameId)));
    }

    public void requestSync(String sessionKey, RequestSyncRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        UUID gameId = request.gameId() != null ? request.gameId() : sessionService.getActiveGame(user.getId());
        if (gameId == null || !canAccessGame(user.getId(), gameId)) {
            reject(sessionKey, gameId == null ? "no_active_game" : "not_a_game_member");
            return;
        }
        sendSyncToUser(user.getId(), gameId);
    }

    public void listRooms(String sessionKey) {
        if (sessionService.getUser(sessionKey) == null) {
            reject(sessionKey, "not_authenticated");
            return;
        }
        sendPublicRooms(sessionKey);
    }

    public void createInvite(String sessionKey, CreateInviteRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
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
        if (user == null || request == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        RoomMessageDto message = roomService.addMessage(user, request);
        if (message == null) {
            return;
        }
        messaging.convertAndSend("/topic/room/" + message.roomCode(), new WsEvent("roomMessage", message));
    }

    public void roomHistory(String sessionKey, RoomHistoryRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null || request.roomCode().isBlank()) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        List<RoomMessageDto> history = roomService.roomHistory(user, request.roomCode());
        if (history == null) {
            reject(sessionKey, "not_a_room_member");
            return;
        }
        sendEventToUser(sessionKey, new WsEvent("roomHistory", new RoomHistoryDto(request.roomCode(), history)));
    }

    public void leaveRoom(String sessionKey, LeaveRoomRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null || request.roomCode().isBlank()) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        roomService.leaveRoom(user, request.roomCode());
        RoomParticipantsDto participants = roomService.roomParticipantsForBroadcast(request.roomCode());
        if (participants != null) {
            messaging.convertAndSend("/topic/room/" + participants.roomCode(), new WsEvent("roomParticipants", participants));
        }
        broadcastPublicRooms();
    }

    public void roomParticipants(String sessionKey, RoomParticipantsRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null || request.roomCode().isBlank()) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        RoomParticipantsDto participants = roomService.roomParticipants(user, request.roomCode());
        if (participants == null) {
            reject(sessionKey, "not_a_room_member");
            return;
        }
        sendEventToUser(sessionKey, new WsEvent("roomParticipants", participants));
    }

    public void kickPlayer(String sessionKey, KickPlayerRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null || request.userId() == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
            return;
        }
        RoomService.KickResult result = roomService.kickPlayer(user, request.roomCode(), request.userId());
        if (result.error() != null) {
            sendEventToUser(sessionKey, new WsEvent("roomKickFailed", result.error()));
            return;
        }
        RoomParticipantsDto participants = roomService.roomParticipants(user, request.roomCode());
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
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
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

    @Transactional
    public void startRoomGame(String sessionKey, StartRoomGameRequest request) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null || request == null || request.roomCode() == null) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
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
        if (user == null || request == null || request.roomCode() == null || request.roomCode().isBlank()) {
            reject(sessionKey, user == null ? "not_authenticated" : "malformed_request");
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

    @Transactional
    public void handleDisconnect(String sessionKey) {
        UserEntity user = sessionService.getUser(sessionKey);
        if (user == null) {
            sessionService.clearSession(sessionKey);
            return;
        }
        matchmakingService.cancel(user.getId());
        clearDrawOffersForUser(user.getId());
        List<String> updatedRooms = roomService.handleDisconnect(user);
        UUID gameId = sessionService.getActiveGame(user.getId());
        if (gameId != null) {
            GameEntity game = gameRepository.findLockedById(gameId).orElse(null);
            if (game != null && game.getResult() == GameResult.ONGOING) {
                GamePlayerEntity player = playerRepository.findByGameIdAndUserId(gameId, user.getId());
                if (player != null) {
                    player.setLastSeenAt(Instant.now());
                    playerRepository.save(player);
                }
                afterCommit(() -> {
                    GameEntity latest = gameRepository.findById(gameId).orElse(null);
                    if (latest != null && latest.getResult() == GameResult.ONGOING) {
                        sendOpponentDisconnected(gameId);
                    }
                });
            }
        }
        sessionService.clearSession(sessionKey);
        afterCommit(() -> {
            broadcastPublicRooms();
            for (String roomCode : updatedRooms) {
                RoomParticipantsDto participants = roomService.roomParticipantsForBroadcast(roomCode);
                if (participants != null) {
                    messaging.convertAndSend("/topic/room/" + participants.roomCode(),
                            new WsEvent("roomParticipants", participants));
                }
            }
        });
    }

    @Transactional
    public void handleReconnectTimeouts(java.time.Duration timeout) {
        List<UUID> ongoingIds = gameRepository.findIdsByResult(GameResult.ONGOING);
        for (UUID candidateId : ongoingIds) {
            GameEntity game = gameRepository.findLockedById(candidateId).orElse(null);
            if (game == null || game.getResult() != GameResult.ONGOING || game.getGameType() != GameType.VS_HUMAN) {
                continue;
            }
            Instant now = Instant.now();
            List<GamePlayerEntity> players = playerRepository.findByGameId(game.getId());
            if (players.size() != 2) {
                continue;
            }
            GamePlayerEntity p1 = players.get(0);
            GamePlayerEntity p2 = players.get(1);
            boolean p1Disconnected = p1.getUser() == null || sessionService.getSessionId(p1.getUser().getId()) == null;
            boolean p2Disconnected = p2.getUser() == null || sessionService.getSessionId(p2.getUser().getId()) == null;
            boolean p1Timeout = p1Disconnected && java.time.Duration.between(p1.getLastSeenAt(), now).compareTo(timeout) > 0;
            boolean p2Timeout = p2Disconnected && java.time.Duration.between(p2.getLastSeenAt(), now).compareTo(timeout) > 0;
            if (p1Timeout && p2Timeout) {
                finishGameForDisconnect(game, GameResult.DRAW, now);
            } else if (p1Timeout) {
                finishGameForDisconnect(game, resultForWinner(p2.getColor()), now);
            } else if (p2Timeout) {
                finishGameForDisconnect(game, resultForWinner(p1.getColor()), now);
            }
        }
    }

    @Transactional
    public void handleClockTimeouts() {
        List<UUID> ongoingIds = gameRepository.findIdsByResult(GameResult.ONGOING);
        for (UUID candidateId : ongoingIds) {
            GameEntity game = gameRepository.findLockedById(candidateId).orElse(null);
            if (game == null || game.getResult() != GameResult.ONGOING
                    || game.getGameType() != GameType.VS_HUMAN
                    || game.getTimeControlType() == TimeControlType.UNTIMED) {
                continue;
            }
            Instant now = Instant.now();
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
            UUID gameId = game.getId();
            afterCommit(() -> sendGameEnded(gameId));
        }
    }

    public long reconnectTimeoutMs() {
        return reconnectTimeoutMs;
    }

    private boolean finishGameForDisconnect(GameEntity game, GameResult result, Instant now) {
        if (game.getResult() != GameResult.ONGOING) {
            return false;
        }
        game.setResult(result);
        game.setEndReason(GameEndReason.DISCONNECT_TIMEOUT);
        game.setFinishedAt(now);
        gameRepository.save(game);
        UUID gameId = game.getId();
        afterCommit(() -> sendGameEnded(gameId));
        return true;
    }

    private boolean applyClockTimeoutIfExpired(GameEntity game, Instant now) {
        if (game == null || game.getResult() != GameResult.ONGOING
                || game.getTimeControlType() == TimeControlType.UNTIMED) {
            return false;
        }
        Color sideToMove = game.getSideToMove();
        if (clockService.remainingAfterTick(game, sideToMove, now) > 0L) {
            return false;
        }
        if (sideToMove == Color.WHITE) {
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
        UUID gameId = game.getId();
        afterCommit(() -> sendGameEnded(gameId));
        return true;
    }

    private GameResult resultForWinner(Color winner) {
        return winner == Color.WHITE ? GameResult.WHITE_WIN : GameResult.BLACK_WIN;
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

        UUID gameId = game.getId();
        Long whiteIdToAttach = white.getId();
        Long blackIdToAttach = black.getId();
        String whiteToken = whitePlayer.getReconnectToken();
        String blackToken = blackPlayer.getReconnectToken();
        afterCommit(() -> {
            sessionService.attachGame(whiteIdToAttach, gameId);
            sessionService.attachGame(blackIdToAttach, gameId);
            sendGameStarted(game, whiteIdToAttach, whiteToken, Color.WHITE);
            sendGameStarted(game, blackIdToAttach, blackToken, Color.BLACK);
            sendSyncToUser(whiteIdToAttach, gameId);
            sendSyncToUser(blackIdToAttach, gameId);
        });

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
        player.setReconnectToken(SecureTokenGenerator.generate());
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
                analysis,
                game.getVersion()
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
                game.getBlackTimeLeftMs(),
                game.getVersion()
        );
        sendEvent(game.getId(), "moveRejected", event);
    }

    private void sendMoveRejectedAfterCommit(GameEntity game, String reason) {
        if (game != null) {
            afterCommit(() -> sendMoveRejected(game, reason));
        }
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
                roomCode,
                game.getVersion()
        );
        String sessionId = sessionService.getSessionId(userId);
        if (sessionId != null) {
            messaging.convertAndSendToUser(sessionId, "/queue/game", new WsEvent("gameStarted", event));
        }
    }

    private void sendGameEnded(UUID gameId) {
        GameEntity game = gameRepository.findById(gameId).orElse(null);
        if (game == null || game.getResult() == GameResult.ONGOING) {
            return;
        }
        drawOfferCounts.remove(gameId);
        pendingDrawOffers.remove(gameId);
        List<GamePlayerEntity> players = playerRepository.findByGameId(gameId);
        for (GamePlayerEntity player : players) {
            if (player.getUser() != null) {
                sessionService.detachGame(player.getUser().getId());
            }
        }
        roomService.closeRoomByGame(gameId);
        broadcastPublicRooms();
        List<MoveDto> moves = gameService.loadMoves(gameId).stream()
                .map(move -> new MoveDto(move.getFromSquare(), move.getToSquare(), move.getPromotion(), move.getPlayerColor()))
                .toList();
        GameEndedEvent event = new GameEndedEvent(
                gameId,
                game.getResult(),
                game.getEndReason(),
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs(),
                game.getVersion(),
                moves
        );
        sendEvent(gameId, "gameEnded", event);
    }

    private void sendOpponentDisconnected(UUID gameId) {
        sendEvent(gameId, "opponentDisconnected", new OpponentDisconnectedEvent(gameId));
    }

    private void sendOpponentReconnected(UUID gameId) {
        sendEvent(gameId, "opponentReconnected", new OpponentReconnectedEvent(gameId));
    }

    private boolean hasConnectedOpponent(Long userId, UUID gameId) {
        return playerRepository.findByGameId(gameId).stream()
                .filter(player -> player.getUser() != null && !player.getUser().getId().equals(userId))
                .anyMatch(player -> sessionService.getSessionId(player.getUser().getId()) != null);
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

    private void clearDrawOffersForUser(Long userId) {
        if (userId == null) return;
        pendingDrawOffers.forEach((gameId, offerOwner) -> {
            if (userId.equals(offerOwner) && pendingDrawOffers.remove(gameId, offerOwner)) {
                sendToOpponent(userId, gameId, new WsEvent("drawDeclined", gameId));
            }
        });
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
                game.getTimeControlType(),
                game.getResult(),
                game.getEndReason(),
                moveDtos,
                game.getWhiteTimeLeftMs(),
                game.getBlackTimeLeftMs(),
                game.getLastMoveAt(),
                analysisEnabled ? analysePosition(game) : null,
                game.getVersion()
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
        if (sessionKey == null || sessionKey.isBlank() || event == null) return;
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
        int depth = analysisDepth > 0 ? analysisDepth : base.requestedDepth();
        long timeMs = analysisTimeMs > 0 ? analysisTimeMs : base.hardTimeLimitMillis();
        EngineConfig config = new EngineConfig(
                depth,
                timeMs,
                base.engineElo(),
                base.engineColor(),
                base.skillProfile(),
                EngineStrength.analysis(timeMs, depth, Math.max(1, Math.min(5, analysisMaxLines)))
        );
        EngineResult result = chessEngine.analyseFen(game.getCurrentFen(), game.getSideToMove(), config);
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

    private boolean canAccessGame(Long userId, UUID gameId) {
        return userId != null && gameId != null
                && (playerRepository.findByGameIdAndUserId(gameId, userId) != null
                || roomService.isActiveParticipantInGame(userId, gameId));
    }

    private void reject(String sessionKey, String reason) {
        sendEventToUser(sessionKey, new WsEvent("commandRejected", reason));
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
