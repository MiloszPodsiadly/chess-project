package com.milo.chessengine.config;

import com.milo.chessdomain.Color;

public record EngineConfig(
        int requestedDepth,
        long hardTimeLimitMillis,
        int engineElo,
        Color engineColor,
        SkillProfile skillProfile
) {}
