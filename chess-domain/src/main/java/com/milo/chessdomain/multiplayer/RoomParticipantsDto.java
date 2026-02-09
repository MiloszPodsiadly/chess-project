package com.milo.chessdomain.multiplayer;

import java.util.List;

public record RoomParticipantsDto(
        String roomCode,
        List<RoomParticipantDto> participants
) {}
