package com.milo.chessserver.game;

import com.milo.chessdomain.*;
import com.milo.chessdomain.game.*;
import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.Position;
import com.milo.chessserver.multiplayer.ClockService;
import com.milo.chessserver.user.UserEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class EngineGameService {

    private static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    private final GameRepository gameRepo;
    private final GamePlayerRepository playerRepository;
    private final ChessEngine engine;
    private final GameService gameService;
    private final ClockService clockService;

    public EngineGameService(GameRepository gameRepo,
                             GamePlayerRepository playerRepository,
                             ChessEngine engine,
                             GameService gameService,
                             ClockService clockService) {
        this.gameRepo = gameRepo;
        this.playerRepository = playerRepository;
        this.engine = engine;
        this.gameService = gameService;
        this.clockService = clockService;
    }

    @Transactional
    public GameStateDto startNewVsEngineGame(UserEntity user,
                                             Color playerColor,
                                             int engineElo,
                                             TimeControlType timeControlType) {

        UUID id = UUID.randomUUID();

        GameEntity game = new GameEntity();
        game.setId(id);
        game.setGameType(GameType.VS_ENGINE);
        game.setVariant(GameVariant.STANDARD);
        game.setEngineElo(engineElo);
        game.setCurrentFen(START_FEN);
        game.setSideToMove(Color.WHITE);
        game.setTimeControlType(timeControlType == null ? TimeControlType.RAPID : timeControlType);
        game.setStartedAt(Instant.now());
        game.setResult(GameResult.ONGOING);

        if (playerColor == Color.WHITE) {
            game.setWhitePlayer(user);
        } else {
            game.setBlackPlayer(user);
        }

        gameService.initializeClocks(game);

        gameRepo.save(game);
        persistEnginePlayer(game, user, playerColor);

        EngineResult engineResult = null;
        if (playerColor == Color.BLACK) {
            EngineConfig cfg = EngineConfigMapper.toEngineConfig(engineElo, Color.WHITE);
            Position pos = new Position(game.getCurrentFen(), game.getSideToMove());
            engineResult = engine.findBestMove(pos, cfg);
            if (engineResult != null && engineResult.bestMove() != null) {
                game = gameService.applyMove(game.getId(), engineResult.bestMove());
            }
        }

        List<GameMoveEntity> moves = gameService.loadMoves(game.getId());
        return toGameStateDto(game, moves, engineResult);
    }

    @Transactional
    public GameStateDto playerMove(UUID gameId,
                                   UserEntity user,
                                   MoveDto moveDto,
                                   int engineElo,
                                   TimeControlType timeControlType) {

        GameEntity game = gameRepo.findById(gameId).orElseThrow();

        if (!isPlayerInGame(game, user)) {
            throw new IllegalStateException("User not in this game");
        }
        if (timeControlType != null && timeControlType != game.getTimeControlType()) {
            game.setTimeControlType(timeControlType);
        }
        if (game.getResult() != GameResult.ONGOING) {
            return toGameStateDto(game, gameService.loadMoves(gameId), null);
        }

        checkTimeoutBeforeMove(game);
        game = gameService.applyMove(gameId, moveDto);

        int effectiveElo = engineElo > 0 ? engineElo : game.getEngineElo();
        EngineConfig cfg = EngineConfigMapper.toEngineConfig(effectiveElo, game.getSideToMove());

        Position pos = new Position(game.getCurrentFen(), game.getSideToMove());
        EngineResult engineResult = engine.findBestMove(pos, cfg);

        if (engineResult != null && engineResult.bestMove() != null && game.getResult() == GameResult.ONGOING) {
            MoveDto engineMove = engineResult.bestMove();
            game = gameService.applyMove(game.getId(), engineMove);
        }
        checkTimeoutAfterMove(game);

        List<GameMoveEntity> moves = gameService.loadMoves(gameId);
        return toGameStateDto(game, moves, engineResult);
    }

    private GameStateDto toGameStateDto(GameEntity game,
                                        List<GameMoveEntity> moves,
                                        EngineResult engineResult) {

        EvaluationDto eval = null;
        EngineMoveResponseDto analysis = null;
        if (engineResult != null) {
            eval = new EvaluationDto(
                    engineResult.score().type(),
                    engineResult.score().value(),
                    engineResult.score().side()
            );
            analysis = AnalysisMapper.toResponse(game.getCurrentFen(), engineResult);
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
                game.getFinishedAt()
        );
    }

    private boolean isPlayerInGame(GameEntity game, UserEntity user) {
        return (game.getWhitePlayer() != null && game.getWhitePlayer().getId().equals(user.getId()))
                || (game.getBlackPlayer() != null && game.getBlackPlayer().getId().equals(user.getId()));
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
