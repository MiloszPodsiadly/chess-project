package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.TimeControlType;

public record CreateRoomRequest(
        TimeControlType timeControlType,
        String name,
        String password,
        Boolean isPublic
) {}
