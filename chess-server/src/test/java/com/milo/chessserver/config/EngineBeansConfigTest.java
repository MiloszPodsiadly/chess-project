package com.milo.chessserver.config;

import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.impl.UnavailableChessEngine;
import com.milo.chessengine.impl.EngineUnavailableException;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.core.Position;
import com.milo.chessdomain.Color;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.junit.jupiter.api.Assertions.*;

class EngineBeansConfigTest {
    private final EngineBeansConfig config = new EngineBeansConfig();

    @Test
    void missingEngineIsExplicitlyUnavailable() {
        ChessEngine engine = config.chessEngine("", 0, 0, 5, 0, 100, 100, 100);
        UnavailableChessEngine unavailable = assertInstanceOf(UnavailableChessEngine.class, engine);
        assertTrue(unavailable.reason().contains("STOCKFISH_PATH"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, new EngineHealthController(engine).health().getStatusCode());
        assertThrows(EngineUnavailableException.class, () -> engine.findBestMove(
                new Position("invalid", Color.WHITE), EngineConfigMapper.toEngineConfig(1200, Color.WHITE)));
    }

    @Test
    void failedProcessStartupDoesNotActivateClassicEngine() {
        ChessEngine engine = config.chessEngine("/missing/stockfish", 0, 0, 5, 0, 100, 100, 100);
        UnavailableChessEngine unavailable = assertInstanceOf(UnavailableChessEngine.class, engine);
        assertTrue(unavailable.reason().contains("Failed to start UCI engine"));
    }
}
