package com.milo.chessdomain.multiplayer;

import java.util.UUID;

public record RequestSyncRequest(
        UUID gameId
) {}
