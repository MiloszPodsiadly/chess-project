package com.milo.chessdomain.multiplayer;

import java.time.Instant;
import java.util.List;

public record RoomParticipantsDto(
        String roomCode,
        List<RoomParticipantDto> participants,
        RoomStatus roomStatus,
        RoomClosureReason closeReason,
        RoomLifecycleEventType memberEvent,
        Instant lifecycleAt
) {
    public RoomParticipantsDto(String roomCode, List<RoomParticipantDto> participants) {
        this(roomCode, participants, RoomStatus.OPEN, null, null, null);
    }
}
