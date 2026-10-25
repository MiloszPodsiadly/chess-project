package com.milo.chessengine.config;

import com.milo.chessdomain.Color;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class EngineStrengthTest {
    @Test
    void fullStrengthPresetsNeverCapDepthOrEnableMultiPv() {
        long[] budgets = {3_000, 10_000, 30_000, 60_000};
        EngineStrength.Preset[] presets = EngineStrength.Preset.values();
        assertEquals(budgets.length, presets.length);
        for (int i = 0; i < presets.length; i++) {
            EngineConfig config = EngineConfig.fullStrength(presets[i], Color.BLACK);
            assertEquals(EngineStrength.Mode.FULL_STRENGTH, config.strength().mode());
            assertEquals(budgets[i], config.strength().timeBudgetMs());
            assertEquals(0, config.strength().depthCap());
            assertEquals(1, config.strength().multiPv());
            assertEquals(Color.BLACK, config.engineColor());
        }
    }

    @Test
    void trainingAndBeginnerLevelsHaveExplicitRanges() {
        assertEquals(EngineStrength.Mode.BEGINNER, EngineStrength.fromElo(200, 100, 1).mode());
        assertEquals(EngineStrength.Mode.TRAINING, EngineStrength.fromElo(1320, 500, 1).mode());
        assertEquals(EngineStrength.Mode.TRAINING, EngineStrength.fromElo(3190, 500, 1).mode());
        assertThrows(IllegalArgumentException.class, () -> EngineStrength.fromElo(199, 500, 1));
        assertThrows(IllegalArgumentException.class, () -> EngineStrength.fromElo(3191, 500, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new EngineStrength(EngineStrength.Mode.FULL_STRENGTH, 0, 30_000, 1, 1));
    }

    @Test
    void everyRequestedTargetSurvivesMappingWithoutRounding() {
        int[] levels = {200, 599, 600, 999, 1000, 1319, 1320, 1321, 1600,
                1800, 2000, 2200, 2400, 2800, 3000, 3190};
        for (int level : levels) {
            EngineConfig config = EngineConfigMapper.toEngineConfig(level, Color.WHITE);
            assertEquals(level, config.engineElo(), "Config target " + level);
            assertEquals(level, config.strength().elo(), "UCI target " + level);
            assertEquals(level >= 1320 ? EngineStrength.Mode.TRAINING : EngineStrength.Mode.BEGINNER,
                    config.strength().mode());
        }
        assertThrows(IllegalArgumentException.class,
                () -> EngineConfigMapper.toEngineConfig(3191, Color.WHITE));
    }
}
