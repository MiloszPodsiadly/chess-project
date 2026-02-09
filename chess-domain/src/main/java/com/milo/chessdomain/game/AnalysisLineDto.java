package com.milo.chessdomain.game;

import java.util.List;

public record AnalysisLineDto(
        MoveDto move,
        EvaluationDto evaluation,
        List<MoveDto> principalVariation,
        String san,
        List<String> principalVariationSan
) {}
