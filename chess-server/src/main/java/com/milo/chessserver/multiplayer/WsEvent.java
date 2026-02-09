package com.milo.chessserver.multiplayer;

public record WsEvent(
        String type,
        Object payload
) {}
