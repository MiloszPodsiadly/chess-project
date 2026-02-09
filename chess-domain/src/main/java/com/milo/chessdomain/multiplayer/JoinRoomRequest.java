package com.milo.chessdomain.multiplayer;

public record JoinRoomRequest(
        String roomCode,
        String password,
        String inviteToken
) {}
