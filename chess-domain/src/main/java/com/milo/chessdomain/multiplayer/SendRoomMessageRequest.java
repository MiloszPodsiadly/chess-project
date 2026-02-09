package com.milo.chessdomain.multiplayer;

public record SendRoomMessageRequest(
        String roomCode,
        String message
) {}
