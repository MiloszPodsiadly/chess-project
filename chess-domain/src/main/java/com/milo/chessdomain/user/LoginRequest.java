package com.milo.chessdomain.user;

public record LoginRequest(
        String usernameOrEmail,
        String password
) {}
