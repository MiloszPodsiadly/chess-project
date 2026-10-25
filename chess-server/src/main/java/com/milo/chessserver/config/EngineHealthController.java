package com.milo.chessserver.config;

import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.impl.UciChessEngine;
import com.milo.chessengine.impl.PooledChessEngine;
import com.milo.chessengine.impl.UnavailableChessEngine;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class EngineHealthController {
    private final ChessEngine engine;

    public EngineHealthController(ChessEngine engine) {
        this.engine = engine;
    }

    @GetMapping("/api/engine/health")
    public ResponseEntity<Map<String, Object>> health() {
        if (engine instanceof PooledChessEngine pool && pool.isRunning()) {
            return ResponseEntity.ok(Map.of("status", "ready", "metrics", pool.metrics()));
        }
        String reason = engine instanceof UnavailableChessEngine unavailable
                ? unavailable.reason() : "Engine process is not running";
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("status", "unavailable", "reason", reason));
    }
}
