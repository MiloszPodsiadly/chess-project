package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessserver.multiplayer.ClockService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class GameService {

    private final GameRepository gameRepository;
    private final GameMoveRepository moveRepository;
    private final MoveValidationService moveValidationService;
    private final ClockService clockService;

    public GameService(GameRepository gameRepository,
                       GameMoveRepository moveRepository,
                       MoveValidationService moveValidationService,
                       ClockService clockService) {
        this.gameRepository = gameRepository;
        this.moveRepository = moveRepository;
        this.moveValidationService = moveValidationService;
        this.clockService = clockService;
    }

    @Transactional
    public GameEntity applyMove(UUID gameId, MoveDto moveDto) {
        GameEntity game = gameRepository.findLockedById(gameId).orElseThrow();
        if (game.getResult() != GameResult.ONGOING) {
            return game;
        }

        MoveDto effectiveMove = moveDto.playerColor() == game.getSideToMove()
                ? moveDto
                : new MoveDto(moveDto.from(), moveDto.to(), moveDto.promotion(), game.getSideToMove());

        return applyValidatedMove(game, gameId, effectiveMove, Instant.now());
    }

    @Transactional
    public MultiplayerMoveResult applyMultiplayerMove(UUID gameId,
                                                       MoveDto requestedMove,
                                                       Color authorizedColor,
                                                       Instant now) {
        GameEntity game = gameRepository.findLockedById(gameId).orElseThrow();
        if (game.getResult() != GameResult.ONGOING) {
            return new MultiplayerMoveResult(game, false, "game_finished");
        }
        if (authorizedColor == null || authorizedColor != game.getSideToMove()) {
            return new MultiplayerMoveResult(game, false, "not_your_turn");
        }
        if (requestedMove == null || requestedMove.from() == null || requestedMove.to() == null) {
            return new MultiplayerMoveResult(game, false, "malformed_move");
        }

        if (game.getTimeControlType() != TimeControlType.UNTIMED
                && clockService.remainingAfterTick(game, authorizedColor, now) <= 0L) {
            if (authorizedColor == Color.WHITE) {
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
            return new MultiplayerMoveResult(game, false, "time_out");
        }

        MoveDto authoritativeMove = new MoveDto(
                requestedMove.from(), requestedMove.to(), requestedMove.promotion(), authorizedColor);
        GameEntity updated = applyValidatedMove(game, gameId, authoritativeMove, now);
        return new MultiplayerMoveResult(updated, true, null);
    }

    private GameEntity applyValidatedMove(GameEntity game, UUID gameId, MoveDto effectiveMove, Instant now) {

        List<String> fenHistory = new java.util.ArrayList<>(moveRepository.findFenAfterMoveByGameIdOrderByMoveNumberAsc(gameId));
        if (game.getVariant() == com.milo.chessdomain.GameVariant.STANDARD) {
            fenHistory.add(0, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        }
        if (fenHistory.isEmpty()) {
            fenHistory.add(game.getCurrentFen());
        }
        MoveValidationResult validation = moveValidationService.validateAndApply(game.getCurrentFen(), effectiveMove, fenHistory);
        if (!validation.legal()) {
            throw new IllegalArgumentException("Illegal move");
        }

        clockService.applyMove(game, effectiveMove.playerColor(), now);

        game.setCurrentFen(validation.fenAfterMove());
        game.setSideToMove(validation.sideToMove());
        game.setResult(validation.result());
        game.setEndReason(validation.endReason());

        if (game.getTimeControlType() != TimeControlType.UNTIMED) {
            if (effectiveMove.playerColor() == Color.WHITE && game.getWhiteTimeLeftMs() <= 0L) {
                game.setResult(GameResult.BLACK_WIN);
                game.setEndReason(GameEndReason.TIME_OUT);
            } else if (effectiveMove.playerColor() == Color.BLACK && game.getBlackTimeLeftMs() <= 0L) {
                game.setResult(GameResult.WHITE_WIN);
                game.setEndReason(GameEndReason.TIME_OUT);
            }
        }

        if (game.getResult() != GameResult.ONGOING) {
            game.setFinishedAt(now);
        }

        persistMove(game, effectiveMove, validation.fenAfterMove(), now);
        return gameRepository.save(game);
    }

    public record MultiplayerMoveResult(GameEntity game, boolean accepted, String rejectionReason) {}

    public List<GameMoveEntity> loadMoves(UUID gameId) {
        return moveRepository.findByGameIdOrderByMoveNumberAsc(gameId);
    }

    public void initializeClocks(GameEntity game) {
        long initial = clockService.initialTimeMs(game.getTimeControlType());
        game.setWhiteTimeLeftMs(initial);
        game.setBlackTimeLeftMs(initial);
        game.setLastMoveAt(game.getStartedAt());
    }

    private void persistMove(GameEntity game, MoveDto move, String fenAfter, Instant now) {
        int moveNumber = Math.toIntExact(moveRepository.countByGameId(game.getId()) + 1);
        GameMoveEntity entity = new GameMoveEntity();
        entity.setGame(game);
        entity.setMoveNumber(moveNumber);
        entity.setPlayerColor(move.playerColor());
        entity.setFromSquare(move.from());
        entity.setToSquare(move.to());
        entity.setPromotion(move.promotion());
        entity.setFenAfterMove(fenAfter);
        entity.setCreatedAt(now);
        moveRepository.save(entity);
    }
}
