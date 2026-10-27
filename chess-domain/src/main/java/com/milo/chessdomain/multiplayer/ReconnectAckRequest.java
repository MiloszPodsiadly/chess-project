package com.milo.chessdomain.multiplayer;

public record ReconnectAckRequest(String gameId, String ackId) {}
