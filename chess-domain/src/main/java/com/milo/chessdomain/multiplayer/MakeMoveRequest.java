package com.milo.chessdomain.multiplayer;

import com.milo.chessdomain.game.MoveDto;

import java.util.UUID;

public record MakeMoveRequest(
        UUID gameId,
        MoveDto move
) {}
