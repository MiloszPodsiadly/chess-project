package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

@Service
public class MatchmakingService {

    private final SecureRandom random = new SecureRandom();
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final Map<TimeControlType, Queue<QueueEntry>> queues = new ConcurrentHashMap<>();
    private final PasswordEncoder passwordEncoder;

    public MatchmakingService(PasswordEncoder passwordEncoder) {
        this.passwordEncoder = passwordEncoder;
    }

    public String createRoom(Long hostUserId,
                             String hostUsername,
                             TimeControlType timeControlType,
                             String name,
                             String password,
                             boolean isPublic) {
        String code = generateRoomCode();
        String normalizedName = name == null || name.isBlank() ? null : name.trim();
        String normalizedPassword = password == null || password.isBlank() ? null : password.trim();
        String passwordHash = (!isPublic && normalizedPassword != null)
                ? passwordEncoder.encode(normalizedPassword)
                : null;
        rooms.put(code, new Room(code, hostUserId, hostUsername, timeControlType, Instant.now(), normalizedName, passwordHash, isPublic));
        return code;
    }

    public JoinResult joinRoom(String roomCode, String password) {
        if (roomCode == null) {
            return new JoinResult(null, "room_not_found");
        }
        String key = roomCode.toUpperCase(Locale.ROOT);
        Room room = rooms.get(key);
        if (room == null) {
            return new JoinResult(null, "room_not_found");
        }
        if (!room.isPublic) {
            String normalizedPassword = password == null || password.isBlank() ? null : password.trim();
            if (normalizedPassword == null || room.passwordHash == null || !passwordEncoder.matches(normalizedPassword, room.passwordHash)) {
                return new JoinResult(null, "bad_password");
            }
        }
        rooms.remove(key);
        return new JoinResult(room, null);
    }

    public QueueEntry enqueue(TimeControlType type, QueueEntry entry) {
        Queue<QueueEntry> queue = queues.computeIfAbsent(type, k -> new ConcurrentLinkedQueue<>());
        QueueEntry other = queue.poll();
        if (other == null) {
            queue.add(entry);
            return null;
        }
        return other;
    }

    public void cleanup(Duration maxRoomAge, Duration maxQueueAge) {
        Instant now = Instant.now();
        rooms.values().removeIf(room -> Duration.between(room.createdAt, now).compareTo(maxRoomAge) > 0);
        queues.values().forEach(queue -> queue.removeIf(entry -> Duration.between(entry.enqueuedAt, now).compareTo(maxQueueAge) > 0));
    }

    public void removeRoomsForHost(Long hostUserId) {
        if (hostUserId == null) {
            return;
        }
        rooms.values().removeIf(room -> hostUserId.equals(room.hostUserId));
    }

    private String generateRoomCode() {
        String letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            sb.append(letters.charAt(random.nextInt(letters.length())));
        }
        return sb.toString();
    }

    public record Room(String code,
                       Long hostUserId,
                       String hostUsername,
                       TimeControlType timeControlType,
                       Instant createdAt,
                       String name,
                       String passwordHash,
                       boolean isPublic) {}

    public record QueueEntry(Long userId, TimeControlType timeControlType, Instant enqueuedAt) {}

    public record JoinResult(Room room, String error) {}
}
