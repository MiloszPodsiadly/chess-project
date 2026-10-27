package com.milo.chessserver.multiplayer;

import java.security.SecureRandom;
import java.util.Base64;

final class SecureTokenGenerator {
    private static final SecureRandom RANDOM = new SecureRandom();

    private SecureTokenGenerator() {}

    static String generate() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String guestUsername() {
        return "g" + generate().substring(0, 31);
    }
}
