package com.milo.chessdomain.multiplayer;

import java.util.List;

public record RoomHistoryDto(String roomCode, List<RoomMessageDto> messages) {}
