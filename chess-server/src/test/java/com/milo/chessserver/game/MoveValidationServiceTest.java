package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.MoveDto;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MoveValidationServiceTest {

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
}
