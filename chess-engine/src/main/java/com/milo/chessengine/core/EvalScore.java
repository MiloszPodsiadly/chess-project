package com.milo.chessengine.core;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.EvalType;

public record EvalScore(
        EvalType type,
        int value,
        Color side
) {

    public static EvalScore cp(int value, Color side) {
        return new EvalScore(EvalType.CP, value, side);
    }

    public static EvalScore mate(int ply, Color side) {
        return new EvalScore(EvalType.MATE, ply, side);
    }
}
