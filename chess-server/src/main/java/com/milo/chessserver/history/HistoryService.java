package com.milo.chessserver.history;

import com.milo.chessdomain.game.GameSummaryDto;
import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.Square;
import com.github.bhlangonijr.chesslib.move.Move;
import com.github.bhlangonijr.chesslib.move.MoveConversionException;
import com.github.bhlangonijr.chesslib.move.MoveList;
import com.milo.chessserver.game.GameEntity;
import com.milo.chessserver.game.GameMoveEntity;
import com.milo.chessserver.game.GameMoveRepository;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.user.UserEntity;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class HistoryService {

    private final GameRepository gameRepo;
    private final GameMoveRepository moveRepo;

    public HistoryService(GameRepository gameRepo, GameMoveRepository moveRepo) {
        this.gameRepo = gameRepo;
        this.moveRepo = moveRepo;
    }

    public List<GameSummaryDto> getUserHistory(UserEntity user,
                                               Integer page,
                                               Integer size,
                                               com.milo.chessdomain.GameType gameType,
                                               com.milo.chessdomain.TimeControlType timeControlType,
                                               com.milo.chessdomain.GameResult result) {
        org.springframework.data.domain.Pageable pageable = toPageable(page, size);
        List<GameEntity> games = gameRepo.findByWhitePlayerOrBlackPlayer(user, user, pageable).getContent();
        if (gameType != null) {
            games = games.stream().filter(g -> g.getGameType() == gameType).toList();
        }
        if (timeControlType != null) {
            games = games.stream().filter(g -> g.getTimeControlType() == timeControlType).toList();
        }
        if (result != null) {
            games = games.stream().filter(g -> g.getResult() == result).toList();
        }
        return games.stream()
                .map(g -> new GameSummaryDto(
                        g.getId(),
                        g.getGameType(),
                        opponentName(g, user),
                        opponentIsEngine(g, user),
                        playerColor(g, user),
                        g.getResult(),
                        g.getTimeControlType(),
                        ratingFor(g, user),
                        ratingFor(g, user),
                        totalMoves(g),
                        lastMoveUci(g),
                        lastMoveSan(g),
                        g.getStartedAt(),
                        g.getFinishedAt()
                ))
                .toList();
    }

    private String opponentName(GameEntity game, UserEntity user) {
        if (game.getGameType() == com.milo.chessdomain.GameType.VS_ENGINE) {
            return "ENGINE";
        }
        UserEntity opponent = opponentFor(game, user);
        return opponent != null ? opponent.getUsername() : "ENGINE";
    }

    private boolean opponentIsEngine(GameEntity game, UserEntity user) {
        return game.getGameType() == com.milo.chessdomain.GameType.VS_ENGINE || opponentFor(game, user) == null;
    }

    private com.milo.chessdomain.Color playerColor(GameEntity game, UserEntity user) {
        if (game.getWhitePlayer() != null && game.getWhitePlayer().getId().equals(user.getId())) {
            return com.milo.chessdomain.Color.WHITE;
        }
        return com.milo.chessdomain.Color.BLACK;
    }

    private int ratingFor(GameEntity game, UserEntity user) {
        if (game.getGameType() == com.milo.chessdomain.GameType.VS_ENGINE) {
            return user.getRatingVsEngine();
        }
        return switch (game.getTimeControlType()) {
            case BLITZ, BULLET -> user.getRatingBlitz();
            case RAPID, CLASSICAL, UNTIMED -> user.getRatingRapid();
        };
    }

    private UserEntity opponentFor(GameEntity game, UserEntity user) {
        if (game.getWhitePlayer() != null && game.getWhitePlayer().getId().equals(user.getId())) {
            return game.getBlackPlayer();
        }
        return game.getWhitePlayer();
    }

    private int totalMoves(GameEntity game) {
        return Math.toIntExact(moveRepo.countByGameId(game.getId()));
    }

    private String lastMoveUci(GameEntity game) {
        List<GameMoveEntity> moves = moveRepo.findByGameIdOrderByMoveNumberAsc(game.getId());
        if (moves.isEmpty()) {
            return null;
        }
        GameMoveEntity last = moves.get(moves.size() - 1);
        String promo = last.getPromotion();
        return last.getFromSquare() + last.getToSquare() + (promo == null ? "" : promo);
    }

    private String lastMoveSan(GameEntity game) {
        List<GameMoveEntity> moves = moveRepo.findByGameIdOrderByMoveNumberAsc(game.getId());
        if (moves.isEmpty()) {
            return null;
        }
        MoveList moveList = new MoveList(START_FEN);
        try {
            for (GameMoveEntity move : moves) {
                Move chessMove = toMove(move);
                if (chessMove == null) {
                    break;
                }
                moveList.add(chessMove);
            }
            String[] san = moveList.toSanArray();
            return san.length == 0 ? null : san[san.length - 1];
        } catch (MoveConversionException ex) {
            return null;
        }
    }

    private Move toMove(GameMoveEntity move) {
        Square from = Square.fromValue(move.getFromSquare().toUpperCase(java.util.Locale.ROOT));
        Square to = Square.fromValue(move.getToSquare().toUpperCase(java.util.Locale.ROOT));
        if (from == null || to == null) {
            return null;
        }
        if (move.getPromotion() == null || move.getPromotion().isBlank()) {
            return new Move(from, to);
        }
        boolean white = move.getPlayerColor() == com.milo.chessdomain.Color.WHITE;
        Piece promotion = switch (Character.toLowerCase(move.getPromotion().charAt(0))) {
            case 'q' -> white ? Piece.WHITE_QUEEN : Piece.BLACK_QUEEN;
            case 'r' -> white ? Piece.WHITE_ROOK : Piece.BLACK_ROOK;
            case 'b' -> white ? Piece.WHITE_BISHOP : Piece.BLACK_BISHOP;
            case 'n' -> white ? Piece.WHITE_KNIGHT : Piece.BLACK_KNIGHT;
            default -> Piece.NONE;
        };
        return new Move(from, to, promotion);
    }

    private static final String START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    private org.springframework.data.domain.Pageable toPageable(Integer page, Integer size) {
        int p = page != null && page >= 0 ? page : 0;
        int s = size != null && size > 0 ? size : 20;
        return org.springframework.data.domain.PageRequest.of(p, s, org.springframework.data.domain.Sort.by("startedAt").descending());
    }
}
