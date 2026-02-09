package com.milo.chessengine.config;

import com.milo.chessdomain.Color;

public record SkillProfile(
        int maxDepth,
        long timePerMoveMillis,
        int evalNoiseStdCp,
        double suboptimalMoveProb,
        double blunderProb
) {}
