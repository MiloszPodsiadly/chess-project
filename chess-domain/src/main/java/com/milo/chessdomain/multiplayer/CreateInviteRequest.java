package com.milo.chessdomain.multiplayer;

public record CreateInviteRequest(
        String roomCode,
        Integer maxUses,
        Integer expiresInMinutes
) {}
