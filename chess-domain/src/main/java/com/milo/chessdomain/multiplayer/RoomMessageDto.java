package com.milo.chessdomain.multiplayer;

import java.time.Instant;

public record RoomMessageDto(
        String roomCode,
        String username,
        String message,
        Instant createdAt
) {}
