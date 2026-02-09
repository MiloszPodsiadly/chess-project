package com.milo.chessengine.bot;

import com.milo.chessengine.core.EvalScore;
import com.milo.chessdomain.game.MoveDto;

import java.util.List;

public record CandidateMove(
        MoveDto move,
        EvalScore score,
        List<MoveDto> principalVariation
) {}
