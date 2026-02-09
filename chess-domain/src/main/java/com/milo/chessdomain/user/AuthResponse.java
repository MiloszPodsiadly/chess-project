package com.milo.chessdomain.user;

public record AuthResponse(
        String accessToken,
        UserPublicDto user
) {}
