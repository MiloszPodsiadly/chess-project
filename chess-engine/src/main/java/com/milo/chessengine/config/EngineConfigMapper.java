package com.milo.chessengine.config;

import com.milo.chessdomain.Color;

import java.security.SecureRandom;
import java.util.Random;

public final class EngineConfigMapper {

    private static final Random RNG = new SecureRandom();

    private EngineConfigMapper() {}

    public static EloProfile forElo(int elo) {
        if (elo <= 200) {
            return new EloProfile(200, 20, 40, 1, Integer.MAX_VALUE, MoveSelection.RANDOM_LEGAL, 0.45, 0.35);
        }
        if (elo <= 400) {
            return new EloProfile(400, 50, 50, 2, 8, MoveSelection.RANDOM_TOP_N, 0.30, 0.25);
        }
        if (elo <= 600) {
            return new EloProfile(600, 80, 80, 3, 6, MoveSelection.RANDOM_TOP_N, 0.22, 0.18);
        }
        if (elo <= 800) {
            return new EloProfile(800, 120, 120, 4, 5, MoveSelection.RANDOM_TOP_N, 0.16, 0.12);
        }
        if (elo <= 1000) {
            return new EloProfile(1000, 180, 180, 6, 4, MoveSelection.RANDOM_TOP_N, 0.10, 0.08);
        }
        if (elo <= 1200) {
            return new EloProfile(1200, 250, 250, 8, 3, MoveSelection.RANDOM_TOP_N, 0.06, 0.05);
        }
        if (elo <= 1400) {
            return new EloProfile(1400, 350, 350, 10, 2, MoveSelection.TOP_N, 0.03, 0.03);
        }
        if (elo <= 1600) {
            return new EloProfile(1600, 500, 500, 12, 2, MoveSelection.BEST_OR_TOP2, 0.02, 0.02);
        }
        if (elo <= 1800) {
            return new EloProfile(1800, 800, 800, 15, 1, MoveSelection.BEST, 0.01, 0.01);
        }
        return new EloProfile(2000, 1200, 1200, 18, 1, MoveSelection.BEST, 0.005, 0.005);
    }

    public static EngineConfig toEngineConfig(int elo, Color engineColor) {
        EloProfile profile = forElo(elo);
        long timeLimit = profile.pickTimeMillis(RNG.nextLong());
        SkillProfile skill = new SkillProfile(
                profile.depthCap(),
                timeLimit,
                profile.elo() <= 1200 ? 80 : 20,
                profile.blunderProb(),
                profile.blunderProb()
        );
        return new EngineConfig(profile.depthCap(), timeLimit, profile.elo(), engineColor, skill);
    }
}
