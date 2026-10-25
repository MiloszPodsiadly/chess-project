package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.bot.CandidateMove;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.EvalScore;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class AnalysisMapperTest {
    @Test
    void ranksBlackCandidatesBySideToMoveAndConvertsSanFromSearchPosition() {
        String fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
        MoveDto e5 = new MoveDto("e7", "e5", null, Color.BLACK);
        MoveDto d5 = new MoveDto("d7", "d5", null, Color.BLACK);
        EngineResult result = new EngineResult(e5, List.of(e5), EvalScore.cp(100, Color.BLACK),
                12, 1000, 10, List.of(
                new CandidateMove(d5, EvalScore.cp(50, Color.BLACK), List.of(d5)),
                new CandidateMove(e5, EvalScore.cp(100, Color.BLACK), List.of(e5))));

        var mapped = AnalysisMapper.toResponse(fen, result);
        assertEquals(e5, mapped.topLines().get(0).move());
        assertEquals("e5", mapped.topLines().get(0).san());
        assertEquals(d5, mapped.topLines().get(1).move());
    }
}
