package com.milo.chessengine;

import com.milo.chessdomain.Color;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.Position;

public interface ChessEngine {

    EngineResult findBestMove(Position position, EngineConfig config);

    default EngineResult analyseFen(String fen, Color sideToMove, EngineConfig config) {
        Position pos = new Position(fen, sideToMove);
        return findBestMove(pos, config);
    }
}
