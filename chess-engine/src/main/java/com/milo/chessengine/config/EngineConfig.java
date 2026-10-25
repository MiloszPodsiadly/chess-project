package com.milo.chessengine.config;

import com.milo.chessdomain.Color;

public record EngineConfig(
        int requestedDepth,
        long hardTimeLimitMillis,
        int engineElo,
        Color engineColor,
        SkillProfile skillProfile,
        EngineStrength strength
) {
    public EngineConfig(int requestedDepth, long hardTimeLimitMillis, int engineElo,
                        Color engineColor, SkillProfile skillProfile) {
        this(requestedDepth, hardTimeLimitMillis, engineElo, engineColor, skillProfile,
                EngineStrength.fromElo(engineElo, hardTimeLimitMillis, requestedDepth));
    }

    public static EngineConfig fullStrength(EngineStrength.Preset preset, Color color) {
        EngineStrength strength = EngineStrength.full(preset);
        return new EngineConfig(0, strength.timeBudgetMs(), 0, color, null, strength);
    }
}
