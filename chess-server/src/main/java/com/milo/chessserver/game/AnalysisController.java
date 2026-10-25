package com.milo.chessserver.game;

import com.milo.chessdomain.game.AnalysisRequestDto;
import com.milo.chessdomain.game.EngineMoveResponseDto;
import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.config.EngineStrength;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.Position;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/analysis")
public class AnalysisController {

    private final ChessEngine chessEngine;

    public AnalysisController(ChessEngine chessEngine) {
        this.chessEngine = chessEngine;
    }

    @PostMapping
    public EngineMoveResponseDto analyse(@RequestBody AnalysisRequestDto request) {
        if (request == null || request.fen() == null || request.sideToMove() == null) {
            return new EngineMoveResponseDto(null, List.of(), null, 0, 0L, 0L, List.of());
        }
        int elo = request.engineElo() > 0 ? request.engineElo() : 1200;
        EngineConfig base = EngineConfigMapper.toEngineConfig(elo, request.sideToMove());
        int depth = Math.min(30, request.depth() != null && request.depth() > 0
                ? request.depth() : base.requestedDepth());
        long timeMs = Math.min(10_000L, request.timeMillis() != null && request.timeMillis() > 0
                ? request.timeMillis() : base.hardTimeLimitMillis());
        EngineConfig config = new EngineConfig(depth, timeMs, base.engineElo(), base.engineColor(),
                base.skillProfile(), EngineStrength.analysis(timeMs, depth, Math.min(5, Math.max(1,
                request.maxLines() == null ? 5 : request.maxLines()))));

        EngineResult result = chessEngine.analyseFen(request.fen(), request.sideToMove(), config);
        if (result == null) {
            return new EngineMoveResponseDto(null, List.of(), null, 0, 0L, 0L, List.of());
        }

        int maxLines = request.maxLines() != null && request.maxLines() > 0 ? request.maxLines() : 5;
        return AnalysisMapper.toResponse(request.fen(), result, maxLines);
    }

}
