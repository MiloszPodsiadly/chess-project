package com.milo.chessdomain.multiplayer;

import java.util.UUID;

public record ResignRequest(
        UUID gameId
) {}
