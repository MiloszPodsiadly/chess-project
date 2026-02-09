package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.TimeControlType;

import java.time.Instant;

public record PublicRoomDto(
        String roomCode,
        String name,
        String hostUsername,
        TimeControlType timeControlType,
        Instant createdAt,
        RoomStatus status,
        int currentPlayers
) {}
