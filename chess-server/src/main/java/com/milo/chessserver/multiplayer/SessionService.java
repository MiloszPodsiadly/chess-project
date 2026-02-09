package com.milo.chessserver.multiplayer;

import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

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

    public UserEntity registerSession(String sessionKey, String username) {
        String finalName = (username == null || username.isBlank()) ? "guest-" + shortId() : username.trim();
        UserEntity user = userRepository.findByUsername(finalName).orElseGet(() -> {
            UserEntity guest = new UserEntity();
            guest.setUsername(finalName);
            guest.setEmail(finalName + "@guest.local");
            guest.setPasswordHash(passwordEncoder.encode("guest"));
            return userRepository.save(guest);
        });
        sessionToUser.put(sessionKey, user.getId());
        userToSession.put(user.getId(), sessionKey);
        return user;
    }

    public void bindReconnectUser(String sessionKey, UserEntity user) {
        sessionToUser.put(sessionKey, user.getId());
        userToSession.put(user.getId(), sessionKey);
    }

    public UserEntity getUser(String sessionKey) {
        Long userId = sessionToUser.get(sessionKey);
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId).orElse(null);
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

    public void clearSession(String sessionKey) {
        Long userId = sessionToUser.remove(sessionKey);
        if (userId != null) {
            userToSession.remove(userId);
            userToGame.remove(userId);
        }
    }

    private String shortId() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
