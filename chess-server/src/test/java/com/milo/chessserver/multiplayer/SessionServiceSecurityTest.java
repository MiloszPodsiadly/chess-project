package com.milo.chessserver.multiplayer;

import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class SessionServiceSecurityTest {
    @Test
    void guestDisplayNameNeverResolvesToARegisteredAccount() {
        UserRepository users = mock(UserRepository.class);
        PasswordEncoder passwords = mock(PasswordEncoder.class);
        UserEntity registered = new UserEntity();
        registered.setUsername("alice");
        ReflectionTestUtils.setField(registered, "id", 1L);
        AtomicReference<UserEntity> saved = new AtomicReference<>();
        when(passwords.encode(anyString())).thenAnswer(invocation -> "encoded:" + invocation.getArgument(0));
        when(users.save(any(UserEntity.class))).thenAnswer(invocation -> {
            UserEntity guest = invocation.getArgument(0);
            ReflectionTestUtils.setField(guest, "id", 2L);
            saved.set(guest);
            return guest;
        });
        when(users.findById(2L)).thenAnswer(invocation -> Optional.ofNullable(saved.get()));
        when(users.findByUsername("alice")).thenReturn(Optional.of(registered));

        SessionService sessions = new SessionService(users, passwords);
        UserEntity guest = sessions.registerGuestSession("ws-guest", "alice");

        assertTrue(guest.isGuest());
        assertNotEquals("alice", guest.getUsername());
        assertEquals("alice", guest.getDisplayName());
        assertNotEquals("guest", guest.getPasswordHash());
        assertSame(guest, sessions.getUser("ws-guest"));
        verify(users, never()).findByUsername("alice");
    }

    @Test
    void staleSocketCleanupCannotRemoveNewSessionOwnershipOrItsActiveGame() {
        UserRepository users = mock(UserRepository.class);
        UserEntity user = new UserEntity();
        user.setUsername("internal-user");
        ReflectionTestUtils.setField(user, "id", 77L);
        when(users.findById(77L)).thenReturn(Optional.of(user));
        SessionService sessions = new SessionService(users, mock(PasswordEncoder.class));
        UUID gameId = UUID.randomUUID();

        sessions.bindReconnectUser("old-socket", user);
        sessions.attachGame(77L, gameId);
        sessions.bindReconnectUser("new-socket", user);
        sessions.clearSession("old-socket");

        assertNull(sessions.getUser("old-socket"));
        assertSame(user, sessions.getUser("new-socket"));
        assertEquals("new-socket", sessions.getSessionId(77L));
        assertEquals(gameId, sessions.getActiveGame(77L));
    }

    @Test
    void reconnectTokensHave256BitsOfSecureRandomMaterial() {
        String first = SecureTokenGenerator.generate();
        String second = SecureTokenGenerator.generate();

        assertEquals(43, first.length());
        assertEquals(32, Base64.getUrlDecoder().decode(first).length);
        assertNotEquals(first, second);
    }
}
