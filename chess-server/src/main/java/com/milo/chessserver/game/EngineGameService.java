package com.milo.chessserver.game;

import com.milo.chessdomain.*;
import com.milo.chessdomain.game.*;
import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.config.EngineStrength;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.Position;
import com.milo.chessserver.multiplayer.ClockService;
import com.milo.chessserver.user.UserEntity;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.scheduling.annotation.Scheduled;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;

@Service
public class EngineGameService {
    private static final Logger log = LoggerFactory.getLogger(EngineGameService.class);

    private static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    private static final int MAX_ATTEMPTS = 3;
    private static final java.time.Duration TURN_LEASE = java.time.Duration.ofSeconds(150);

    private final GameRepository gameRepo;
    private final GamePlayerRepository playerRepository;
    private final ChessEngine engine;
    private final GameService gameService;
    private final ClockService clockService;
    private final TransactionTemplate transactions;
    private final ExecutorService turnExecutor;

    public EngineGameService(GameRepository gameRepo,
                             GamePlayerRepository playerRepository,
                             ChessEngine engine,
                             GameService gameService,
                             ClockService clockService,
                             TransactionTemplate transactions,
                             ExecutorService turnExecutor) {
        this.gameRepo = gameRepo;
        this.playerRepository = playerRepository;
        this.engine = engine;
        this.gameService = gameService;
        this.clockService = clockService;
        this.transactions = transactions;
        this.turnExecutor = turnExecutor;
    }

    public GameStateDto startNewVsEngineGame(UserEntity user,
                                             Color playerColor,
                                             int engineElo,
                                             TimeControlType timeControlType) {
        return startNewVsEngineGame(user, playerColor, engineElo, timeControlType, null,
                EngineStrength.Preset.STRONG);
    }

    public GameStateDto startNewVsEngineGame(UserEntity user,
                                             Color playerColor,
                                             int engineElo,
                                             TimeControlType timeControlType,
                                             EngineStrength.Mode requestedMode,
                                             EngineStrength.Preset preset) {
        EngineStrength.Preset selectedPreset = preset == null ? EngineStrength.Preset.STRONG : preset;
        EngineStrength.Mode mode = requestedMode == null
                ? (engineElo < 1320 ? EngineStrength.Mode.BEGINNER : EngineStrength.Mode.TRAINING)
                : requestedMode;
        if (mode == EngineStrength.Mode.ANALYSIS) {
            throw new IllegalArgumentException("Analysis is not a gameplay mode");
        }
        if (mode == EngineStrength.Mode.TRAINING) {
            EngineStrength.training(engineElo, selectedPreset.budgetMs());
        } else if (mode == EngineStrength.Mode.BEGINNER) {
            EngineStrength.beginner(engineElo, 1, 1, 1);
        }

        UUID id = UUID.randomUUID();
        UUID[] execution = new UUID[1];
        transactions.execute(status -> {
            GameEntity game = new GameEntity();
            game.setId(id);
            game.setGameType(GameType.VS_ENGINE);
            game.setVariant(GameVariant.STANDARD);
            game.setEngineElo(engineElo);
            game.setEngineMode(mode);
            game.setEnginePreset(mode == EngineStrength.Mode.BEGINNER ? null : selectedPreset);
            game.setCurrentFen(START_FEN);
            game.setSideToMove(Color.WHITE);
            game.setTimeControlType(timeControlType == null ? TimeControlType.RAPID : timeControlType);
            game.setStartedAt(Instant.now());
            game.setResult(GameResult.ONGOING);
            game.setEngineTurnState(playerColor == Color.BLACK
                    ? GameTurnState.ENGINE_THINKING : GameTurnState.PLAYER_TURN);
            if (playerColor == Color.BLACK) execution[0] = claimTurn(game);
            if (playerColor == Color.WHITE) {
                game.setWhitePlayer(user);
            } else {
                game.setBlackPlayer(user);
            }
            gameService.initializeClocks(game);
            gameRepo.save(game);
            persistEnginePlayer(game, user, playerColor);
            return null;
        });
        if (execution[0] != null) dispatch(id, execution[0]);
        return getGame(id, user);
    }

    public GameStateDto playerMove(UUID gameId,
                                   UserEntity user,
                                   MoveDto moveDto,
                                   int engineElo,
                                   TimeControlType timeControlType) {
        return playerMove(gameId, user, moveDto, null);
    }

    public GameStateDto playerMove(UUID gameId, UserEntity user, MoveDto moveDto, Long expectedVersion) {
        UUID execution = transactions.execute(status -> {
            GameEntity game = lockedGame(gameId, user);
            if (expectedVersion != null && !expectedVersion.equals(game.getVersion())) {
                throw new IllegalStateException("Stale game version");
            }
            if (game.getResult() != GameResult.ONGOING) {
                return null;
            }
            if (game.getEngineTurnState() != null && game.getEngineTurnState() != GameTurnState.PLAYER_TURN) {
                return null;
            }
            if (game.getSideToMove() != playerSide(game, user)) {
                throw new IllegalStateException("Not the player's turn");
            }
            checkTimeoutBeforeMove(game);
            if (game.getResult() != GameResult.ONGOING) {
                game.setEngineTurnState(GameTurnState.FINISHED);
                game.setEngineExecutionId(null);
                game.setEngineLeaseUntil(null);
                gameRepo.save(game);
                return null;
            }
            GameEntity moved = gameService.applyMove(gameId, moveDto);
            moved.setEngineTurnState(moved.getResult() == GameResult.ONGOING
                    ? GameTurnState.ENGINE_THINKING : GameTurnState.FINISHED);
            UUID turnId = moved.getResult() == GameResult.ONGOING ? claimTurn(moved) : null;
            gameRepo.save(moved);
            return turnId;
        });
        if (execution != null) dispatch(gameId, execution);
        return getGame(gameId, user);
    }

    private record PendingTurn(Position position, EngineConfig config, String fen, Long version) {}

    private GameStateDto completeEngineTurn(UUID gameId, UUID executionId) {
        PendingTurn pending = transactions.execute(status -> {
            GameEntity game = gameRepo.findById(gameId).orElseThrow();
            if (game.getResult() != GameResult.ONGOING
                    || game.getEngineTurnState() != GameTurnState.ENGINE_THINKING
                    || !executionId.equals(game.getEngineExecutionId())) {
                return null;
            }
            return new PendingTurn(enginePosition(game), engineConfig(game, game.getSideToMove()),
                    game.getCurrentFen(), game.getVersion());
        });
        if (pending == null) {
            return readGame(gameId, null);
        }
        EngineResult result;
        try {
            result = engine.findBestMove(pending.position(), pending.config());
            if (result == null || result.bestMove() == null) {
                throw new IllegalStateException("Stockfish returned no move");
            }
            return transactions.execute(status -> {
                GameEntity game = gameRepo.findLockedById(gameId).orElseThrow();
                if (game.getEngineTurnState() != GameTurnState.ENGINE_THINKING
                        || game.getResult() != GameResult.ONGOING
                        || !executionId.equals(game.getEngineExecutionId())
                        || !game.getCurrentFen().equals(pending.fen())
                        || !java.util.Objects.equals(game.getVersion(), pending.version())) {
                    return toGameStateDto(game, gameService.loadMoves(gameId), null);
                }
                GameEntity moved = gameService.applyMove(gameId, result.bestMove());
                checkTimeoutAfterMove(moved);
                moved.setEngineTurnState(moved.getResult() == GameResult.ONGOING
                        ? GameTurnState.PLAYER_TURN : GameTurnState.FINISHED);
                moved.setEngineError(null);
                moved.setEngineExecutionId(null);
                moved.setEngineLeaseUntil(null);
                gameRepo.save(moved);
                gameRepo.flush();
                return toGameStateDto(moved, gameService.loadMoves(gameId), result, pending.fen());
            });
        } catch (RuntimeException ex) {
            log.error("Engine turn failed for game {}", gameId, ex);
            transactions.execute(status -> {
                GameEntity game = gameRepo.findLockedById(gameId).orElseThrow();
                if (game.getEngineTurnState() == GameTurnState.ENGINE_THINKING
                        && executionId.equals(game.getEngineExecutionId())
                        && game.getCurrentFen().equals(pending.fen())) {
                    game.setEngineTurnState(GameTurnState.ENGINE_FAILED);
                    game.setEngineError(ex.getMessage() == null ? "Engine failed"
                            : ex.getMessage().substring(0, Math.min(256, ex.getMessage().length())));
                    game.setEngineExecutionId(null);
                    game.setEngineLeaseUntil(null);
                    gameRepo.save(game);
                }
                return null;
            });
            return readGame(gameId, null);
        }
    }

    private GameStateDto toGameStateDto(GameEntity game,
                                        List<GameMoveEntity> moves,
                                        EngineResult engineResult) {
        return toGameStateDto(game, moves, engineResult, game.getCurrentFen());
    }

    private GameStateDto toGameStateDto(GameEntity game,
                                        List<GameMoveEntity> moves,
                                        EngineResult engineResult,
                                        String analysisFen) {

        EvaluationDto eval = null;
        EngineMoveResponseDto analysis = null;
        if (engineResult != null) {
            if (engineResult.score() != null) {
            eval = new EvaluationDto(
                    engineResult.score().type(),
                    engineResult.score().value(),
                    engineResult.score().side()
            );
            }
            analysis = AnalysisMapper.toResponse(analysisFen, engineResult);
        }

        List<MoveDto> moveDtos = moves.stream()
                .map(m -> new MoveDto(
                        m.getFromSquare(),
                        m.getToSquare(),
                        m.getPromotion(),
                        m.getPlayerColor()))
                .toList();

        return new GameStateDto(
                game.getId(),
                game.getCurrentFen(),
                game.getSideToMove(),
                game.getResult(),
                game.getEndReason(),
                moveDtos,
                eval,
                analysis,
                game.getStartedAt(),
                game.getFinishedAt(),
                game.getEngineTurnState(),
                game.getVersion(),
                game.getEngineError(),
                game.getEngineMode() == null ? null : game.getEngineMode().name(),
                game.getEnginePreset() == null ? null : game.getEnginePreset().name(),
                game.getEngineMode() == EngineStrength.Mode.FULL_STRENGTH ? null : game.getEngineElo(),
                configuredEngineTimeBudgetMs(game),
                game.getWhitePlayer() != null ? Color.WHITE : Color.BLACK,
                game.getEngineExecutionId()
        );
    }

    public GameStateDto getGame(UUID gameId, UserEntity user) {
        return readGame(gameId, user);
    }

    private GameStateDto readGame(UUID gameId, UserEntity user) {
        return transactions.execute(status -> {
            GameEntity game = gameRepo.findById(gameId).orElseThrow();
            if (user != null && !isPlayerInGame(game, user)) {
                throw new IllegalStateException("User not in this game");
            }
            return toGameStateDto(game, gameService.loadMoves(gameId), null);
        });
    }

    public GameStateDto retryEngineTurn(UUID gameId, UserEntity user) {
        UUID execution = transactions.execute(status -> {
            GameEntity game = lockedGame(gameId, user);
            if (game.getResult() != GameResult.ONGOING) {
                return null;
            }
            boolean expired = game.getEngineTurnState() == GameTurnState.ENGINE_THINKING
                    && (game.getEngineLeaseUntil() == null || game.getEngineLeaseUntil().isBefore(Instant.now()));
            if (game.getEngineTurnState() == GameTurnState.ENGINE_FAILED || expired) {
                if (game.getEngineAttempts() >= MAX_ATTEMPTS) {
                    game.setEngineTurnState(GameTurnState.ENGINE_FAILED);
                    game.setEngineError("Engine retry limit reached");
                    game.setEngineExecutionId(null);
                    gameRepo.save(game);
                    return null;
                }
                UUID claimed = claimTurn(game);
                gameRepo.save(game);
                return claimed;
            }
            return null;
        });
        if (execution != null) dispatch(gameId, execution);
        return getGame(gameId, user);
    }

    @Scheduled(fixedDelay = 5000, initialDelay = 10000)
    public void recoverAbandonedTurns() {
        for (GameEntity candidate : gameRepo
                .findTop20ByGameTypeAndEngineTurnStateAndResultOrderByEngineLeaseUntilAsc(
                        GameType.VS_ENGINE, GameTurnState.ENGINE_THINKING, GameResult.ONGOING)) {
            if (candidate.getEngineLeaseUntil() != null
                    && candidate.getEngineLeaseUntil().isAfter(Instant.now())) continue;
            try {
                UUID execution = transactions.execute(status -> {
                    GameEntity game = gameRepo.findLockedById(candidate.getId()).orElseThrow();
                    if (game.getEngineTurnState() != GameTurnState.ENGINE_THINKING
                            || game.getResult() != GameResult.ONGOING
                            || (game.getEngineLeaseUntil() != null
                            && game.getEngineLeaseUntil().isAfter(Instant.now()))) return null;
                    if (game.getEngineAttempts() >= MAX_ATTEMPTS) {
                        game.setEngineTurnState(GameTurnState.ENGINE_FAILED);
                        game.setEngineError("Engine recovery limit reached");
                        game.setEngineExecutionId(null);
                        gameRepo.save(game);
                        return null;
                    }
                    UUID claimed = claimTurn(game);
                    gameRepo.save(game);
                    return claimed;
                });
                if (execution != null) dispatch(candidate.getId(), execution);
            } catch (RuntimeException ex) {
                log.warn("Failed to recover engine turn {}", candidate.getId(), ex);
            }
        }
    }

    private UUID claimTurn(GameEntity game) {
        UUID execution = UUID.randomUUID();
        game.setEngineTurnState(GameTurnState.ENGINE_THINKING);
        game.setEngineExecutionId(execution);
        game.setEngineLeaseUntil(Instant.now().plus(TURN_LEASE));
        game.setEngineAttempts(game.getEngineAttempts() + 1);
        game.setEngineError(null);
        return execution;
    }

    private void dispatch(UUID gameId, UUID execution) {
        try {
            turnExecutor.execute(() -> completeEngineTurn(gameId, execution));
        } catch (RejectedExecutionException ex) {
            transactions.execute(status -> {
                GameEntity game = gameRepo.findLockedById(gameId).orElseThrow();
                if (execution.equals(game.getEngineExecutionId())) {
                    game.setEngineTurnState(GameTurnState.ENGINE_FAILED);
                    game.setEngineExecutionId(null);
                    game.setEngineLeaseUntil(null);
                    game.setEngineError("Engine queue is full; retry this turn");
                    gameRepo.save(game);
                }
                return null;
            });
        }
    }

    public GameStateDto resign(UUID gameId, UserEntity user) {
        return transactions.execute(status -> {
            GameEntity game = lockedGame(gameId, user);
            if (game.getResult() == GameResult.ONGOING) {
                game.setResult(playerSide(game, user) == Color.WHITE
                        ? GameResult.BLACK_WIN : GameResult.WHITE_WIN);
                game.setEndReason(GameEndReason.RESIGNATION);
                game.setFinishedAt(Instant.now());
                game.setEngineTurnState(GameTurnState.FINISHED);
                game.setEngineExecutionId(null);
                game.setEngineLeaseUntil(null);
                gameRepo.save(game);
            }
            gameRepo.flush();
            return toGameStateDto(game, gameService.loadMoves(gameId), null);
        });
    }

    public GameStateDto restart(UUID gameId, UserEntity user) {
        GameEntity previous = transactions.execute(status -> {
            GameEntity game = lockedGame(gameId, user);
            if (game.getResult() == GameResult.ONGOING) {
                game.setResult(playerSide(game, user) == Color.WHITE
                        ? GameResult.BLACK_WIN : GameResult.WHITE_WIN);
                game.setEndReason(GameEndReason.RESIGNATION);
                game.setFinishedAt(Instant.now());
                game.setEngineTurnState(GameTurnState.FINISHED);
                game.setEngineExecutionId(null);
                game.setEngineLeaseUntil(null);
                gameRepo.save(game);
            }
            return game;
        });
        return startNewVsEngineGame(user, playerSide(previous, user), previous.getEngineElo(),
                previous.getTimeControlType(), previous.getEngineMode(), previous.getEnginePreset());
    }

    private GameEntity lockedGame(UUID id, UserEntity user) {
        GameEntity game = gameRepo.findLockedById(id).orElseThrow();
        if (!isPlayerInGame(game, user) || game.getGameType() != GameType.VS_ENGINE) {
            throw new IllegalStateException("User not in this engine game");
        }
        return game;
    }

    private Color playerSide(GameEntity game, UserEntity user) {
        return game.getWhitePlayer() != null && game.getWhitePlayer().getId().equals(user.getId())
                ? Color.WHITE : Color.BLACK;
    }

    private boolean isPlayerInGame(GameEntity game, UserEntity user) {
        return (game.getWhitePlayer() != null && game.getWhitePlayer().getId().equals(user.getId()))
                || (game.getBlackPlayer() != null && game.getBlackPlayer().getId().equals(user.getId()));
    }

    private Position enginePosition(GameEntity game) {
        List<String> history = gameService.loadMoves(game.getId()).stream()
                .map(move -> move.getFromSquare() + move.getToSquare()
                        + (move.getPromotion() == null ? "" : move.getPromotion()))
                .toList();
        return new Position(game.getCurrentFen(), game.getSideToMove(), game.getId().toString(), history);
    }

    private EngineConfig engineConfig(GameEntity game, Color side) {
        if (game.getEngineMode() == EngineStrength.Mode.FULL_STRENGTH) {
            return EngineConfig.fullStrength(selectedPreset(game), side);
        }
        if (game.getEngineMode() == EngineStrength.Mode.TRAINING) {
            return EngineConfigMapper.toEngineConfig(game.getEngineElo(), side,
                    selectedPreset(game).budgetMs());
        }
        return EngineConfigMapper.toEngineConfig(game.getEngineElo(), side);
    }

    private Long configuredEngineTimeBudgetMs(GameEntity game) {
        if (game.getEngineMode() == EngineStrength.Mode.TRAINING
                || game.getEngineMode() == EngineStrength.Mode.FULL_STRENGTH) {
            return selectedPreset(game).budgetMs();
        }
        return null;
    }

    private EngineStrength.Preset selectedPreset(GameEntity game) {
        return game.getEnginePreset() == null ? EngineStrength.Preset.STRONG : game.getEnginePreset();
    }

    private void checkTimeoutBeforeMove(GameEntity game) {
        if (game.getTimeControlType() == TimeControlType.UNTIMED || game.getResult() != GameResult.ONGOING) {
            return;
        }
        long remaining = clockService.remainingAfterTick(game, game.getSideToMove(), java.time.Instant.now());
        if (remaining <= 0L) {
            if (game.getSideToMove() == Color.WHITE) {
                game.setResult(GameResult.BLACK_WIN);
            } else {
                game.setResult(GameResult.WHITE_WIN);
            }
            game.setEndReason(GameEndReason.TIME_OUT);
            game.setFinishedAt(java.time.Instant.now());
            gameRepo.save(game);
        }
    }

    private void checkTimeoutAfterMove(GameEntity game) {
        if (game.getTimeControlType() == TimeControlType.UNTIMED || game.getResult() != GameResult.ONGOING) {
            return;
        }
        long remaining = clockService.remainingAfterTick(game, game.getSideToMove(), java.time.Instant.now());
        if (remaining <= 0L) {
            if (game.getSideToMove() == Color.WHITE) {
                game.setResult(GameResult.BLACK_WIN);
            } else {
                game.setResult(GameResult.WHITE_WIN);
            }
            game.setEndReason(GameEndReason.TIME_OUT);
            game.setFinishedAt(java.time.Instant.now());
            gameRepo.save(game);
        }
    }

    private void persistEnginePlayer(GameEntity game, UserEntity user, Color playerColor) {
        GamePlayerEntity player = new GamePlayerEntity();
        player.setGame(game);
        player.setUser(user);
        player.setColor(playerColor);
        player.setPlayerType(PlayerType.HUMAN);
        player.setRatingAtStart(user.getRatingVsEngine());
        player.setReconnectToken(java.util.UUID.randomUUID().toString().replace("-", ""));
        playerRepository.save(player);
    }

}
