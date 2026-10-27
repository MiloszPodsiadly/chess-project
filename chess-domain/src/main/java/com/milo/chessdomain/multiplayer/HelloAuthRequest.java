package com.milo.chessdomain.multiplayer;

public record HelloAuthRequest(
        String username,
        String reconnectToken,
        String roomReconnectToken
) {
    public HelloAuthRequest(String username, String reconnectToken) {
        this(username, reconnectToken, null);
    }
}
