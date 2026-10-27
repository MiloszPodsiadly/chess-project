package com.milo.chessdomain.multiplayer;

public record HelloAck(
        String username,
        String reconnectToken,
        Long userId,
        String roomReconnectToken,
        String gameId,
        String reconnectAckId
) {
    public HelloAck(String username, String reconnectToken, Long userId) {
        this(username, reconnectToken, userId, null, null, null);
    }

    public HelloAck(String username, String reconnectToken, Long userId, String roomReconnectToken) {
        this(username, reconnectToken, userId, roomReconnectToken, null, null);
    }
}
