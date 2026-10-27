package com.milo.chessdomain.multiplayer;

public record KickPlayerRequest(
        String roomCode,
        Long userId
) {}
