package com.milo.chessserver.multiplayer;

import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Session ownership is process-local. Durable reconnect credentials survive a restart,
 * but active-session coordination currently assumes a single server node.
 */
@Service
public class SessionService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final Map<String, Long> sessionToUser = new ConcurrentHashMap<>();
    private final Map<Long, String> userToSession = new ConcurrentHashMap<>();
    private final Map<Long, UUID> userToGame = new ConcurrentHashMap<>();

    public SessionService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public UserEntity registerGuestSession(String sessionKey, String requestedDisplayName) {
        if (sessionKey == null || sessionKey.isBlank()) {
            throw new IllegalArgumentException("WebSocket session is required");
        }
        String internalUsername = SecureTokenGenerator.guestUsername();
        UserEntity user = new UserEntity();
        user.setUsername(internalUsername);
        user.setEmail(internalUsername + "@guest.local");
        user.setPasswordHash(passwordEncoder.encode(SecureTokenGenerator.generate()));
        user.setDisplayName(normalizeDisplayName(requestedDisplayName, internalUsername));
        user.setGuest(true);
        user = userRepository.save(user);
        bindSession(sessionKey, user);
        return user;
    }

    public void bindReconnectUser(String sessionKey, UserEntity user) {
        if (sessionKey == null || sessionKey.isBlank() || user == null || user.getId() == null) {
            throw new IllegalArgumentException("Session and reconnect user are required");
        }
        bindSession(sessionKey, user);
    }

    public synchronized UserEntity getUser(String sessionKey) {
        if (sessionKey == null || sessionKey.isBlank()) return null;
        Long userId = sessionToUser.get(sessionKey);
        if (userId == null || !sessionKey.equals(userToSession.get(userId))) {
            return null;
        }
        return userRepository.findById(userId).orElse(null);
    }

    public boolean isCurrentSession(String sessionKey, Long userId) {
        return sessionKey != null && userId != null && sessionKey.equals(userToSession.get(userId));
    }

    public void attachGame(Long userId, UUID gameId) {
        userToGame.put(userId, gameId);
    }

    public void detachGame(Long userId) {
        userToGame.remove(userId);
    }

    public UUID getActiveGame(Long userId) {
        return userToGame.get(userId);
    }

    public String getSessionId(Long userId) {
        return userToSession.get(userId);
    }

    public synchronized void clearSession(String sessionKey) {
        if (sessionKey == null || sessionKey.isBlank()) return;
        Long userId = sessionToUser.remove(sessionKey);
        if (userId != null && userToSession.remove(userId, sessionKey)) {
            userToGame.remove(userId);
        }
    }

    private synchronized void bindSession(String sessionKey, UserEntity user) {
        if (user == null || user.getId() == null) {
            throw new IllegalArgumentException("Persisted user identity is required");
        }
        Long previousUserId = sessionToUser.put(sessionKey, user.getId());
        if (previousUserId != null && !previousUserId.equals(user.getId())) {
            userToSession.remove(previousUserId, sessionKey);
        }
        userToSession.put(user.getId(), sessionKey);
    }

    private String normalizeDisplayName(String requested, String internalUsername) {
        String candidate = requested == null ? "" : requested.trim();
        String normalized = candidate.codePoints()
                .filter(codePoint -> !Character.isISOControl(codePoint))
                .limit(32)
                .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append)
                .toString()
                .trim();
        return normalized.isBlank() ? "Guest-" + internalUsername.substring(internalUsername.length() - 6) : normalized;
    }
}
