package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.bot.CandidateMove;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.EvalScore;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AnalysisMapperTest {
    @Test
    void keepsUciMultiPvOrderWhenBlackIsToMove() {
        MoveDto first = new MoveDto("e7", "e5", null, Color.BLACK);
        MoveDto second = new MoveDto("d7", "d5", null, Color.BLACK);
        EngineResult result = new EngineResult(first, List.of(first), EvalScore.cp(80, Color.BLACK),
                12, 1000, 100, List.of(
                new CandidateMove(first, EvalScore.cp(80, Color.BLACK), List.of(first)),
                new CandidateMove(second, EvalScore.cp(-10, Color.BLACK), List.of(second))));

        var response = AnalysisMapper.toResponse(
                "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", result);

        assertEquals(first, response.bestMove());
        assertEquals(first, response.topLines().get(0).move());
        assertEquals(second, response.topLines().get(1).move());
        assertEquals(Color.BLACK, response.evaluation().side());
    }
}
