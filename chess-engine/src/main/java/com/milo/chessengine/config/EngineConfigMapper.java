package com.milo.chessengine.config;

import com.milo.chessdomain.Color;

import java.security.SecureRandom;
import java.util.Random;

public final class EngineConfigMapper {

    private static final Random RNG = new SecureRandom();

    private EngineConfigMapper() {}

    public static BeginnerProfile forBeginnerLevel(int level) {
        if (level < 200 || level >= 1320) {
            throw new IllegalArgumentException("Beginner level must be 200..1319");
        }
        if (level <= 200) {
            return new BeginnerProfile(200, 20, 40, 1, Integer.MAX_VALUE, MoveSelection.RANDOM_LEGAL, 0.45, 0.35);
        }
        if (level <= 400) {
            return new BeginnerProfile(400, 50, 50, 2, 8, MoveSelection.RANDOM_TOP_N, 0.30, 0.25);
        }
        if (level <= 600) {
            return new BeginnerProfile(600, 80, 80, 3, 6, MoveSelection.RANDOM_TOP_N, 0.22, 0.18);
        }
        if (level <= 800) {
            return new BeginnerProfile(800, 120, 120, 4, 5, MoveSelection.RANDOM_TOP_N, 0.16, 0.12);
        }
        if (level <= 1000) {
            return new BeginnerProfile(1000, 180, 180, 6, 4, MoveSelection.RANDOM_TOP_N, 0.10, 0.08);
        }
        if (level <= 1200) {
            return new BeginnerProfile(1200, 250, 250, 8, 3, MoveSelection.RANDOM_TOP_N, 0.06, 0.05);
        }
        return new BeginnerProfile(1319, 350, 350, 10, 2, MoveSelection.TOP_N, 0.03, 0.03);
    }

    public static EngineConfig toEngineConfig(int elo, Color engineColor) {
        return toEngineConfig(elo, engineColor, EngineStrength.Preset.STRONG.budgetMs());
    }

    public static EngineConfig toEngineConfig(int elo, Color engineColor, long trainingTimeBudgetMs) {
        if (elo < 200 || elo > 3190) {
            throw new IllegalArgumentException("Engine target must be 200..3190");
        }
        if (elo >= 1320) {
            if (trainingTimeBudgetMs < 1 || trainingTimeBudgetMs > EngineStrength.Preset.DEEP_CHALLENGE.budgetMs()) {
                throw new IllegalArgumentException("Training search budget must be 1..60000 ms");
            }
            return new EngineConfig(0, trainingTimeBudgetMs, elo, engineColor, null,
                    EngineStrength.training(elo, trainingTimeBudgetMs));
        }
        BeginnerProfile profile = forBeginnerLevel(elo);
        long timeLimit = profile.pickTimeMillis(RNG.nextLong());
        SkillProfile skill = new SkillProfile(
                profile.depthCap(),
                timeLimit,
                profile.bandMax() <= 1200 ? 80 : 20,
                profile.blunderProb(),
                profile.blunderProb()
        );
        return new EngineConfig(profile.depthCap(), timeLimit, elo, engineColor, skill,
                EngineStrength.fromElo(elo, timeLimit, profile.depthCap()));
    }
}
