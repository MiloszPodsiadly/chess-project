package com.milo.chessengine.core;

import com.milo.chessdomain.Color;

public class Position {
    private String fen;
    private Color sideToMove;

    public Position(String fen, Color sideToMove) {
        this.fen = fen;
        this.sideToMove = sideToMove;
    }

    public String fen() { return fen; }
    public Color sideToMove() { return sideToMove; }
}
