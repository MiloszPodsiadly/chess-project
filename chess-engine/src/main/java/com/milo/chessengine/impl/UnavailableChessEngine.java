package com.milo.chessengine.impl;

import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.Position;

/** Explicit failure state for an unavailable native UCI engine. */
public final class UnavailableChessEngine implements ChessEngine, AutoCloseable {
    private final String reason;

    public UnavailableChessEngine(String reason) {
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }

    @Override
    public EngineResult findBestMove(Position position, EngineConfig config) {
        throw new EngineUnavailableException(reason);
    }

    @Override
    public void close() {
        // No native process was started.
    }
}
