package com.milo.chessengine.impl;

public final class EngineUnavailableException extends IllegalStateException {
    public EngineUnavailableException(String reason) {
        super("Stockfish unavailable: " + reason);
    }
}
