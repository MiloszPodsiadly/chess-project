package com.milo.chessdomain.game;

import java.util.List;

public record EngineMoveResponseDto(
        MoveDto bestMove,
        List<MoveDto> principalVariation,
        EvaluationDto evaluation,
        int depth,
        long nodes,
        long timeMillis,
        List<AnalysisLineDto> topLines
) {}
