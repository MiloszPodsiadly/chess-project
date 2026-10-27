package com.milo.chessengine.impl;

import com.milo.chessengine.config.EngineStrength;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class UciStrengthCommandsTest {
    private static final Map<String, String> OPTIONS = Map.of("UCI_Elo", "type spin default 1320 min 1320 max 3190");

    @Test
    void generatesExactCommandsAcrossTheSupportedStrengthMatrix() {
        int[] targets = {1320, 1321, 1600, 1800, 2000, 2200, 2500, 2800, 3000, 3190};
        for (int target : targets) {
            EngineStrength strength = EngineStrength.training(target, 10_000);
            assertEquals(List.of("setoption name Skill Level value 20",
                    "setoption name UCI_Elo value " + target,
                    "setoption name UCI_LimitStrength value true"),
                    UciChessEngine.strengthCommands(strength, OPTIONS), "UCI target " + target);
            assertEquals("go movetime 10000", UciChessEngine.searchCommand(strength));
        }

        int[] beginnerTargets = {200, 600, 1000, 1200, 1319};
        for (int target : beginnerTargets) {
            int skill = Math.max(0, Math.min(10, (target - 200) / 100));
            EngineStrength strength = EngineStrength.fromElo(target, 500, 1);
            assertEquals(List.of("setoption name UCI_LimitStrength value false",
                    "setoption name Skill Level value " + skill),
                    UciChessEngine.strengthCommands(strength, OPTIONS), "Beginner target " + target);
        }
    }

    @Test
    void maximumUsesUnrestrictedSkillAndNoEloSetting() {
        List<String> commands = UciChessEngine.strengthCommands(
                EngineStrength.full(EngineStrength.Preset.ULTIMATE), OPTIONS);
        assertEquals(List.of("setoption name UCI_LimitStrength value false",
                "setoption name Skill Level value 20"), commands);
        assertEquals("go movetime 30000", UciChessEngine.searchCommand(
                EngineStrength.full(EngineStrength.Preset.ULTIMATE)));
        assertEquals("go movetime 60000", UciChessEngine.searchCommand(
                EngineStrength.full(EngineStrength.Preset.DEEP_CHALLENGE)));
    }

    @Test
    void rejectsTargetOutsideActualEngineOptionRange() {
        assertThrows(IllegalArgumentException.class, () -> UciChessEngine.strengthCommands(
                EngineStrength.training(2800, 1000),
                Map.of("UCI_Elo", "type spin min 1320 max 2500")));
    }
}
