package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.GameEndReason;
import com.milo.chessdomain.GameResult;
import com.milo.chessdomain.game.MoveDto;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MoveValidationServiceTest {
    private static final String START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    private final MoveValidationService service = new MoveValidationService();

    @Test
    void legalMoveUpdatesFenAndSide() {
        String startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        MoveDto move = new MoveDto("e2", "e4", null, Color.WHITE);

        MoveValidationResult result = service.validateAndApply(startFen, move);

        assertTrue(result.legal());
        assertEquals(Color.BLACK, result.sideToMove());
        assertNotEquals(startFen, result.fenAfterMove());
    }

    @Test
    void illegalMoveIsRejected() {
        String startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        MoveDto move = new MoveDto("e2", "e5", null, Color.WHITE);

        MoveValidationResult result = service.validateAndApply(startFen, move);

        assertFalse(result.legal());
        assertEquals(startFen, result.fenAfterMove());
        assertEquals(Color.WHITE, result.sideToMove());
    }

    @Test
    void detectsCheckmateAndRepetitionFromPositionHistory() {
        String fen = START;
        java.util.List<String> history = new java.util.ArrayList<>();
        history.add(fen);
        for (String uci : new String[]{"f2f3", "e7e5", "g2g4", "d8h4"}) {
            MoveValidationResult result = service.validateAndApply(fen,
                    new MoveDto(uci.substring(0, 2), uci.substring(2, 4), null, Color.WHITE), history);
            assertTrue(result.legal());
            fen = result.fenAfterMove();
            history.add(fen);
            if (uci.equals("d8h4")) {
                assertEquals(GameResult.BLACK_WIN, result.result());
                assertEquals(GameEndReason.CHECKMATE, result.endReason());
            }
        }

        fen = START;
        history = new java.util.ArrayList<>();
        history.add(fen);
        for (String uci : new String[]{"g1f3", "g8f6", "f3g1", "f6g8",
                "g1f3", "g8f6", "f3g1", "f6g8"}) {
            MoveValidationResult result = service.validateAndApply(fen,
                    new MoveDto(uci.substring(0, 2), uci.substring(2, 4), null, Color.WHITE), history);
            assertTrue(result.legal());
            fen = result.fenAfterMove();
            if (uci.equals("f6g8") && history.size() == 8) {
                assertEquals(GameResult.DRAW, result.result());
                assertEquals(GameEndReason.THREEFOLD_REPETITION, result.endReason());
            }
            history.add(fen);
        }
    }

    @Test
    void handlesPromotionCastlingEnPassantAndFiftyMoveRule() {
        assertTrue(service.validateAndApply("7k/P7/8/8/8/8/8/K7 w - - 0 1",
                new MoveDto("a7", "a8", "q", Color.WHITE)).legal());
        assertTrue(service.validateAndApply("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
                new MoveDto("e1", "g1", null, Color.WHITE)).legal());
        assertTrue(service.validateAndApply("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1",
                new MoveDto("e5", "d6", null, Color.WHITE)).legal());
        MoveValidationResult fifty = service.validateAndApply("7k/8/8/8/8/8/1R6/K7 w - - 99 1",
                new MoveDto("b2", "b3", null, Color.WHITE));
        assertEquals(GameResult.DRAW, fifty.result());
        assertEquals(GameEndReason.FIFTY_MOVE_RULE, fifty.endReason());
    }
}
