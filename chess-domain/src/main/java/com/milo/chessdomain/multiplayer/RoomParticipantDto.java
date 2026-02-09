package com.milo.chessdomain.multiplayer;

public record RoomParticipantDto(
        String username,
        String role,
        String status
) {}
