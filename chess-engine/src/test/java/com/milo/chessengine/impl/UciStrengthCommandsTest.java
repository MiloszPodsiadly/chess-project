package com.milo.chessengine.impl;

import com.milo.chessengine.config.EngineStrength;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class UciStrengthCommandsTest {
    private static final Map<String, String> OPTIONS = Map.of("UCI_Elo", "type spin default 1320 min 1320 max 3190");

    @Test
    void sendsExactTrainingTargetToUci() {
        for (int target : new int[]{1320, 1321, 1600, 1800, 2000, 2200, 2400, 2800, 3000, 3190}) {
            List<String> commands = UciChessEngine.strengthCommands(EngineStrength.training(target, 1000), OPTIONS);
            assertTrue(commands.contains("setoption name UCI_Elo value " + target));
            assertTrue(commands.contains("setoption name UCI_LimitStrength value true"));
        }
    }

    @Test
    void maximumUsesUnrestrictedSkillAndNoEloSetting() {
        List<String> commands = UciChessEngine.strengthCommands(
                EngineStrength.full(EngineStrength.Preset.ULTIMATE), OPTIONS);
        assertEquals(List.of("setoption name UCI_LimitStrength value false",
                "setoption name Skill Level value 20"), commands);
    }

    @Test
    void rejectsTargetOutsideActualEngineOptionRange() {
        assertThrows(IllegalArgumentException.class, () -> UciChessEngine.strengthCommands(
                EngineStrength.training(2800, 1000),
                Map.of("UCI_Elo", "type spin min 1320 max 2500")));
    }
}
