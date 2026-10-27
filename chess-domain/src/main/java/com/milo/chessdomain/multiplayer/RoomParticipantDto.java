package com.milo.chessdomain.multiplayer;

public record RoomParticipantDto(
        Long userId,
        String username,
        String role,
        String status
) {}
