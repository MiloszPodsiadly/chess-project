package com.milo.chessdomain.multiplayer;

import java.time.Instant;

public record RoomLifecycleEvent(
        String roomCode,
        RoomLifecycleEventType type,
        RoomStatus roomStatus,
        RoomClosureReason closeReason,
        Long participantUserId,
        Instant occurredAt
) {}
