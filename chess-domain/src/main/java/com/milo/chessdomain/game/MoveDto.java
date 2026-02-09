package com.milo.chessdomain.game;

import com.milo.chessdomain.Color;

public record MoveDto(
        String from,
        String to,
        String promotion,
        Color playerColor
) {}
