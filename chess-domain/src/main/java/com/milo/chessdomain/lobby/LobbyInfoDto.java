package com.milo.chessdomain.lobby;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.TimeControlType;

import java.time.Instant;
import java.util.UUID;

public record LobbyInfoDto(
        UUID lobbyId,
        String joinCode,
        Long hostUserId,
        Color hostColor,
        TimeControlType tcType,
        Instant createdAt
) {}
