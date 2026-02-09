package com.milo.chessdomain.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.EvalType;

public record EvaluationDto(
        EvalType type,
        int value,
        Color side
) {}
