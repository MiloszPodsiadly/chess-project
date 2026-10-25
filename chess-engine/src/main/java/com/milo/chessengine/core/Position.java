package com.milo.chessengine.core;

import com.milo.chessdomain.Color;
import java.util.List;

public class Position {
    private final String fen;
    private final Color sideToMove;
    private final String gameId;
    private final List<String> movesFromStart;

    public Position(String fen, Color sideToMove) {
        this(fen, sideToMove, null, List.of());
    }

    public Position(String fen, Color sideToMove, String gameId, List<String> movesFromStart) {
        this.fen = fen;
        this.sideToMove = sideToMove;
        this.gameId = gameId;
        this.movesFromStart = List.copyOf(movesFromStart);
    }

    public String fen() { return fen; }
    public Color sideToMove() { return sideToMove; }
    public String gameId() { return gameId; }
    public List<String> movesFromStart() { return movesFromStart; }
}
