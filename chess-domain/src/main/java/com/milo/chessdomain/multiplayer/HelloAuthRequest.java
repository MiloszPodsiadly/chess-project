package com.milo.chessdomain.multiplayer;

public record HelloAuthRequest(
        String username,
        String reconnectToken
) {}
