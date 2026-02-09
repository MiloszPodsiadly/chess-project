package com.milo.chessdomain.multiplayer;

public record GameStateSyncEvent(
        GameStateSyncDto state
) {}
