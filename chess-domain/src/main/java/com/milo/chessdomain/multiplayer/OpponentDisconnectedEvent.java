package com.milo.chessdomain.multiplayer;

import java.util.UUID;

public record OpponentDisconnectedEvent(
        UUID gameId
) {}
