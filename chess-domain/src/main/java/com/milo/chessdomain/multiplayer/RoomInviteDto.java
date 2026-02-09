package com.milo.chessdomain.multiplayer;

import java.time.Instant;

public record RoomInviteDto(
        String roomCode,
        String token,
        Instant expiresAt,
        int maxUses,
        int uses
) {}
