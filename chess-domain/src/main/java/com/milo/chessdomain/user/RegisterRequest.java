package com.milo.chessdomain.user;

public record RegisterRequest(
        String username,
        String email,
        String password
) {}
