package com.milo.chessdomain;

public enum GameEndReason {
    NONE,
    CHECKMATE,
    STALEMATE,
    RESIGNATION,
    TIME_OUT,
    AGREED_DRAW,
    THREEFOLD_REPETITION,
    FIFTY_MOVE_RULE,
    INSUFFICIENT_MATERIAL,
    DISCONNECT_TIMEOUT
}
