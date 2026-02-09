package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.TimeControlType;

public record QueueMatchmakingRequest(
        TimeControlType timeControlType
) {}
