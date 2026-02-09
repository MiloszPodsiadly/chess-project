package com.milo.chessengine.core;

import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.bot.CandidateMove;

import java.util.List;

public record EngineResult(
        MoveDto bestMove,
        List<MoveDto> principalVariation,
        EvalScore score,
        int depthReached,
        long nodes,
        long timeMillis,
        List<CandidateMove> topMoves
) {}
