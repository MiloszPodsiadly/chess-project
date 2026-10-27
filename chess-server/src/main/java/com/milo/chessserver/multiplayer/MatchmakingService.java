package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.function.Predicate;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class MatchmakingService {

    private final SecureRandom random = new SecureRandom();
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final Map<TimeControlType, ArrayDeque<QueueEntry>> queues = new ConcurrentHashMap<>();
    private final Map<Long, QueueEntry> queuedByUser = new ConcurrentHashMap<>();
    private final PasswordEncoder passwordEncoder;
    private static final Duration QUEUE_TTL = Duration.ofMinutes(5);

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

    public synchronized JoinResult joinRoom(String roomCode, String password) {
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
        if (!rooms.remove(key, room)) {
            return new JoinResult(null, "room_not_found");
        }
        return new JoinResult(room, null);
    }

    public synchronized QueueResult enqueueOrMatch(QueueEntry entry) {
        return enqueueOrMatch(entry, ignored -> true);
    }

    public synchronized QueueResult enqueueOrMatch(QueueEntry entry, Predicate<QueueEntry> eligibleOpponent) {
        if (entry == null || entry.userId() == null || entry.timeControlType() == null) {
            throw new IllegalArgumentException("A matchmaking user and time control are required");
        }
        removeExpiredQueueEntries(Instant.now());
        QueueEntry existing = queuedByUser.get(entry.userId());
        if (existing != null) {
            return new QueueResult(null, existing, true);
        }

        ArrayDeque<QueueEntry> queue = queues.computeIfAbsent(entry.timeControlType(), ignored -> new ArrayDeque<>());
        QueueEntry other;
        while ((other = queue.pollFirst()) != null) {
            queuedByUser.remove(other.userId(), other);
            if (other.userId().equals(entry.userId()) || isExpired(other, Instant.now())
                    || (eligibleOpponent != null && !eligibleOpponent.test(other))) {
                continue;
            }
            return new QueueResult(other, null, false);
        }
        queue.addLast(entry);
        queuedByUser.put(entry.userId(), entry);
        return new QueueResult(null, entry, false);
    }

    /** Compatibility helper for callers that only need the matched opponent. */
    public synchronized QueueEntry enqueue(TimeControlType type, QueueEntry entry) {
        QueueEntry normalized = entry == null
                ? null : new QueueEntry(entry.userId(), type, entry.enqueuedAt());
        return enqueueOrMatch(normalized).matchedEntry();
    }

    public synchronized boolean cancel(Long userId) {
        if (userId == null) {
            return false;
        }
        QueueEntry entry = queuedByUser.remove(userId);
        if (entry == null) {
            return false;
        }
        ArrayDeque<QueueEntry> queue = queues.get(entry.timeControlType());
        if (queue != null) {
            queue.remove(entry);
        }
        return true;
    }

    public synchronized void cleanup(Duration maxRoomAge, Duration maxQueueAge) {
        Instant now = Instant.now();
        rooms.values().removeIf(room -> Duration.between(room.createdAt, now).compareTo(maxRoomAge) > 0);
        for (ArrayDeque<QueueEntry> queue : queues.values()) {
            Iterator<QueueEntry> entries = queue.iterator();
            while (entries.hasNext()) {
                QueueEntry entry = entries.next();
                if (entry.enqueuedAt() == null
                        || Duration.between(entry.enqueuedAt(), now).compareTo(maxQueueAge) > 0) {
                    entries.remove();
                    queuedByUser.remove(entry.userId(), entry);
                }
            }
        }
    }

    public void removeRoomsForHost(Long hostUserId) {
        if (hostUserId == null) {
            return;
        }
        rooms.values().removeIf(room -> hostUserId.equals(room.hostUserId));
    }

    private void removeExpiredQueueEntries(Instant now) {
        for (ArrayDeque<QueueEntry> queue : queues.values()) {
            Iterator<QueueEntry> entries = queue.iterator();
            while (entries.hasNext()) {
                QueueEntry entry = entries.next();
                if (isExpired(entry, now)) {
                    entries.remove();
                    queuedByUser.remove(entry.userId(), entry);
                }
            }
        }
    }

    private boolean isExpired(QueueEntry entry, Instant now) {
        return entry.enqueuedAt() == null || Duration.between(entry.enqueuedAt(), now).compareTo(QUEUE_TTL) > 0;
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

    public record QueueResult(QueueEntry matchedEntry, QueueEntry queuedEntry, boolean alreadyQueued) {}

    public record JoinResult(Room room, String error) {}
}
