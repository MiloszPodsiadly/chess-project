package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;

/**
 * Process-local matchmaking queues. Queue reservations are retained until the
 * game-creation transaction commits or rolls back; this implementation assumes
 * a single application JVM and does not coordinate queues across nodes.
 */
@Service
public class MatchmakingService {

    private static final Duration QUEUE_TTL = Duration.ofMinutes(5);

    private final Map<TimeControlType, ArrayDeque<QueueEntry>> queues = new HashMap<>();
    private final Map<Long, QueueEntry> queuedByUser = new HashMap<>();
    private final Map<UUID, MatchReservation> reservations = new HashMap<>();
    private final Map<Long, MatchReservation> reservationByUser = new HashMap<>();
    private final Map<UUID, PendingQueueEntry> pendingQueueReservations = new HashMap<>();
    private final Map<Long, PendingQueueEntry> pendingQueueByUser = new HashMap<>();

    public synchronized QueueResult enqueueOrMatch(QueueEntry entry,
                                                    Predicate<QueueEntry> eligibleOpponent) {
        if (entry == null || entry.userId() == null || entry.timeControlType() == null) {
            throw new IllegalArgumentException("A matchmaking user and time control are required");
        }
        Instant now = Instant.now();
        removeExpiredQueueEntries(now);

        MatchReservation activeMatch = reservationByUser.get(entry.userId());
        if (activeMatch != null) {
            return new QueueResult(null, null, true, true, false, activeMatch.id, null);
        }
        PendingQueueEntry pending = pendingQueueByUser.get(entry.userId());
        if (pending != null) {
            return new QueueResult(null, pending.entry, true, false, true, null, null);
        }
        QueueEntry existing = queuedByUser.get(entry.userId());
        if (existing != null) {
            return new QueueResult(null, existing, true, false, false, null, null);
        }

        ArrayDeque<QueueEntry> queue = queues.computeIfAbsent(entry.timeControlType(), ignored -> new ArrayDeque<>());
        QueueEntry other;
        while ((other = queue.pollFirst()) != null) {
            queuedByUser.remove(other.userId(), other);
            if (other.userId().equals(entry.userId()) || isExpired(other, now)) {
                continue;
            }
            boolean eligible;
            try {
                eligible = eligibleOpponent == null || eligibleOpponent.test(other);
            } catch (RuntimeException failure) {
                insertQueueEntry(other);
                throw failure;
            }
            if (!eligible) {
                continue;
            }

            MatchReservation reservation = new MatchReservation(UUID.randomUUID(), other, entry);
            reservations.put(reservation.id, reservation);
            reservationByUser.put(other.userId(), reservation);
            reservationByUser.put(entry.userId(), reservation);
            return new QueueResult(other, null, false, false, false, reservation.id, null);
        }

        PendingQueueEntry staged = new PendingQueueEntry(UUID.randomUUID(), entry);
        pendingQueueReservations.put(staged.id, staged);
        pendingQueueByUser.put(entry.userId(), staged);
        return new QueueResult(null, entry, false, false, false, null, staged.id);
    }

    public synchronized QueueEntry commitQueuedEntry(UUID reservationId) {
        PendingQueueEntry pending = pendingQueueReservations.remove(reservationId);
        if (pending == null) return null;
        pendingQueueByUser.remove(pending.entry.userId(), pending);
        if (pending.cancelled || isExpired(pending.entry, Instant.now())
                || queuedByUser.containsKey(pending.entry.userId())
                || reservationByUser.containsKey(pending.entry.userId())) {
            return null;
        }
        insertQueueEntry(pending.entry);
        return pending.entry;
    }

    public synchronized void rollbackQueuedEntry(UUID reservationId) {
        PendingQueueEntry pending = pendingQueueReservations.remove(reservationId);
        if (pending != null) pendingQueueByUser.remove(pending.entry.userId(), pending);
    }

    /** Returns true if this reservation is still eligible and is now committing. */
    public boolean beginCommit(UUID reservationId, Predicate<QueueEntry> eligible) {
        MatchReservation snapshot;
        synchronized (this) {
            snapshot = reservations.get(reservationId);
            if (snapshot == null || snapshot.committing || !snapshot.cancelledUserIds.isEmpty()) {
                return false;
            }
        }

        boolean waitingEligible = eligible == null || eligible.test(snapshot.waitingEntry);
        boolean joiningEligible = eligible == null || eligible.test(snapshot.joiningEntry);
        synchronized (this) {
            MatchReservation current = reservations.get(reservationId);
            if (current != snapshot || current.committing || !current.cancelledUserIds.isEmpty()) {
                return false;
            }
            if (!waitingEligible || !joiningEligible) {
                if (!waitingEligible) current.ineligibleUserIds.add(snapshot.waitingEntry.userId());
                if (!joiningEligible) current.ineligibleUserIds.add(snapshot.joiningEntry.userId());
                return false;
            }
            current.committing = true;
            return true;
        }
    }

    public synchronized void completeMatch(UUID reservationId) {
        MatchReservation reservation = reservations.remove(reservationId);
        if (reservation == null) return;
        reservationByUser.remove(reservation.waitingEntry.userId(), reservation);
        reservationByUser.remove(reservation.joiningEntry.userId(), reservation);
    }

    /** Requeues only connected, still-eligible participants and preserves FIFO order. */
    public List<QueueEntry> rollbackMatch(UUID reservationId, Predicate<QueueEntry> eligible) {
        MatchReservation snapshot;
        synchronized (this) {
            snapshot = reservations.get(reservationId);
            if (snapshot == null) return List.of();
        }

        Map<Long, Boolean> eligibility = new HashMap<>();
        eligibility.put(snapshot.waitingEntry.userId(), safelyEligible(eligible, snapshot.waitingEntry));
        eligibility.put(snapshot.joiningEntry.userId(), safelyEligible(eligible, snapshot.joiningEntry));

        synchronized (this) {
            MatchReservation current = reservations.get(reservationId);
            if (current != snapshot) return List.of();
            reservations.remove(reservationId);
            reservationByUser.remove(current.waitingEntry.userId(), current);
            reservationByUser.remove(current.joiningEntry.userId(), current);

            Instant now = Instant.now();
            List<QueueEntry> restored = new ArrayList<>(2);
            restoreEntry(current, current.waitingEntry, eligibility, now, restored);
            restoreEntry(current, current.joiningEntry, eligibility, now, restored);
            restored.sort(Comparator.comparing(QueueEntry::enqueuedAt));
            return List.copyOf(restored);
        }
    }

    public synchronized CancelResult cancel(Long userId) {
        if (userId == null) return CancelResult.NOT_QUEUED;
        QueueEntry entry = queuedByUser.remove(userId);
        if (entry != null) {
            ArrayDeque<QueueEntry> queue = queues.get(entry.timeControlType());
            if (queue != null) queue.remove(entry);
            return CancelResult.CANCELED;
        }
        MatchReservation reservation = reservationByUser.get(userId);
        if (reservation == null) {
            PendingQueueEntry pending = pendingQueueByUser.remove(userId);
            if (pending == null) return CancelResult.NOT_QUEUED;
            pending.cancelled = true;
            pendingQueueReservations.remove(pending.id, pending);
            return CancelResult.CANCELED;
        }
        if (reservation.committing) return CancelResult.MATCH_COMMITTING;
        reservation.cancelledUserIds.add(userId);
        return CancelResult.CANCEL_REQUESTED;
    }

    public synchronized void cleanup(Duration maxQueueAge) {
        Instant now = Instant.now();
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

    private void restoreEntry(MatchReservation reservation,
                              QueueEntry entry,
                              Map<Long, Boolean> eligibility,
                              Instant now,
                              List<QueueEntry> restored) {
        Long userId = entry.userId();
        if (reservation.cancelledUserIds.contains(userId)
                || reservation.ineligibleUserIds.contains(userId)
                || !Boolean.TRUE.equals(eligibility.get(userId))
                || isExpired(entry, now)
                || queuedByUser.containsKey(userId)
                || reservationByUser.containsKey(userId)) {
            return;
        }
        insertQueueEntry(entry);
        restored.add(entry);
    }

    private boolean safelyEligible(Predicate<QueueEntry> eligible, QueueEntry entry) {
        try {
            return eligible == null || eligible.test(entry);
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    private void insertQueueEntry(QueueEntry entry) {
        ArrayDeque<QueueEntry> queue = queues.computeIfAbsent(entry.timeControlType(), ignored -> new ArrayDeque<>());
        List<QueueEntry> entries = new ArrayList<>(queue);
        entries.removeIf(existing -> existing.userId().equals(entry.userId()));
        entries.add(entry);
        entries.sort(Comparator.comparing(QueueEntry::enqueuedAt,
                Comparator.nullsLast(Comparator.naturalOrder())));
        queue.clear();
        queue.addAll(entries);
        queuedByUser.put(entry.userId(), entry);
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

    public record QueueEntry(Long userId, TimeControlType timeControlType, Instant enqueuedAt) {}

    public record QueueResult(QueueEntry matchedEntry,
                              QueueEntry queuedEntry,
                              boolean alreadyQueued,
                              boolean matching,
                              boolean queuePending,
                              UUID reservationId,
                              UUID queueReservationId) {}

    public enum CancelResult {
        CANCELED,
        CANCEL_REQUESTED,
        MATCH_COMMITTING,
        NOT_QUEUED
    }

    private static final class MatchReservation {
        private final UUID id;
        private final QueueEntry waitingEntry;
        private final QueueEntry joiningEntry;
        private final Set<Long> cancelledUserIds = new HashSet<>();
        private final Set<Long> ineligibleUserIds = new HashSet<>();
        private boolean committing;

        private MatchReservation(UUID id, QueueEntry waitingEntry, QueueEntry joiningEntry) {
            this.id = id;
            this.waitingEntry = waitingEntry;
            this.joiningEntry = joiningEntry;
        }
    }

    private static final class PendingQueueEntry {
        private final UUID id;
        private final QueueEntry entry;
        private boolean cancelled;

        private PendingQueueEntry(UUID id, QueueEntry entry) {
            this.id = id;
            this.entry = entry;
        }
    }
}
