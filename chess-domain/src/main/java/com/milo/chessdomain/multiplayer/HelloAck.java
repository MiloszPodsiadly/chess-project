package com.milo.chessdomain.multiplayer;

public record HelloAck(
        String username,
        String reconnectToken,
        Long userId
) {}
