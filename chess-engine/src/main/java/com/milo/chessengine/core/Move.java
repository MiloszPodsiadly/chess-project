package com.milo.chessengine.core;

public record Move(
        int from,
        int to,
        int promotion
) {}
