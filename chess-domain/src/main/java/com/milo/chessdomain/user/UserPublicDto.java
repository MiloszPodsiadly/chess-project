package com.milo.chessdomain.user;

public record UserPublicDto(
        Long id,
        String username,
        int ratingRapid,
        int ratingBlitz,
        int ratingVsEngine
) {}
