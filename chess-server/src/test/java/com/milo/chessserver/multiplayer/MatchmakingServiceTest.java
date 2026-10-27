package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class MatchmakingServiceTest {

    @Test
    void oneUserCanOnlyHoldOneQueuePositionAndCanCancelIt() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueResult first = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        assertEquals(1L, first.queuedEntry().userId());
        service.commitQueuedEntry(first.queueReservationId());

        MatchmakingService.QueueResult duplicate = service.enqueueOrMatch(entry(1L, TimeControlType.BLITZ), ignored -> true);
        assertTrue(duplicate.alreadyQueued());
        assertEquals(TimeControlType.RAPID, duplicate.queuedEntry().timeControlType());

        assertEquals(MatchmakingService.CancelResult.CANCELED, service.cancel(1L));
        assertEquals(MatchmakingService.CancelResult.NOT_QUEUED, service.cancel(1L));
    }

    @Test
    void simultaneousQueueRequestsForSameUserCreateOnePosition() throws Exception {
        MatchmakingService service = new MatchmakingService();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<MatchmakingService.QueueResult> first = executor.submit(
                    () -> enqueueTogether(service, ready, start, 1L, TimeControlType.RAPID));
            Future<MatchmakingService.QueueResult> second = executor.submit(
                    () -> enqueueTogether(service, ready, start, 1L, TimeControlType.BLITZ));
            assertTrue(ready.await(2, TimeUnit.SECONDS));
            start.countDown();
            List<MatchmakingService.QueueResult> results = List.of(first.get(2, TimeUnit.SECONDS), second.get(2, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter(result -> result.queueReservationId() != null).count());
            assertEquals(1, results.stream().filter(MatchmakingService.QueueResult::alreadyQueued).count());
            assertEquals(MatchmakingService.CancelResult.CANCELED, service.cancel(1L));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void aMatchReservationPreventsDuplicateMatchingUntilItsTransactionCompletes() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueResult first = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        service.commitQueuedEntry(first.queueReservationId());

        MatchmakingService.QueueResult paired = service.enqueueOrMatch(entry(2L, TimeControlType.RAPID), ignored -> true);
        assertEquals(1L, paired.matchedEntry().userId());
        assertNotNull(paired.reservationId());
        assertTrue(service.enqueueOrMatch(entry(1L, TimeControlType.BLITZ), ignored -> true).matching());
        assertTrue(service.enqueueOrMatch(entry(2L, TimeControlType.BLITZ), ignored -> true).matching());

        assertTrue(service.beginCommit(paired.reservationId(), ignored -> true));
        assertEquals(MatchmakingService.CancelResult.MATCH_COMMITTING, service.cancel(1L));
        service.completeMatch(paired.reservationId());
        assertEquals(MatchmakingService.CancelResult.NOT_QUEUED, service.cancel(1L));
    }

    @Test
    void reconnectingWhileQueuedKeepsTheOriginalQueuePosition() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueEntry original = entry(1L, TimeControlType.RAPID);
        MatchmakingService.QueueResult queued = service.enqueueOrMatch(original, ignored -> true);
        service.commitQueuedEntry(queued.queueReservationId());

        MatchmakingService.QueueResult reconnect = service.enqueueOrMatch(
                entry(1L, TimeControlType.BLITZ), ignored -> true);
        assertTrue(reconnect.alreadyQueued());
        assertEquals(original, reconnect.queuedEntry());
        assertEquals(1L, service.enqueueOrMatch(entry(2L, TimeControlType.RAPID), ignored -> true)
                .matchedEntry().userId());
    }

    @Test
    void concurrentRequestsCannotReserveTheSameOpponentTwice() throws Exception {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueResult waiting = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        service.commitQueuedEntry(waiting.queueReservationId());
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<MatchmakingService.QueueResult> first = executor.submit(
                    () -> enqueueTogether(service, ready, start, 2L, TimeControlType.RAPID));
            Future<MatchmakingService.QueueResult> second = executor.submit(
                    () -> enqueueTogether(service, ready, start, 3L, TimeControlType.RAPID));
            assertTrue(ready.await(2, TimeUnit.SECONDS));
            start.countDown();
            List<MatchmakingService.QueueResult> results = List.of(first.get(2, TimeUnit.SECONDS), second.get(2, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter(result -> result.matchedEntry() != null).count());
            assertEquals(1, results.stream().filter(result -> result.queueReservationId() != null).count());
            MatchmakingService.QueueResult matched = results.stream()
                    .filter(result -> result.matchedEntry() != null).findFirst().orElseThrow();
            service.rollbackMatch(matched.reservationId(), ignored -> true);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void rollbackRestoresBothEligibleUsersInTheirOriginalFifoOrder() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueResult first = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        service.commitQueuedEntry(first.queueReservationId());
        MatchmakingService.QueueResult paired = service.enqueueOrMatch(entry(2L, TimeControlType.RAPID), ignored -> true);

        List<MatchmakingService.QueueEntry> restored = service.rollbackMatch(paired.reservationId(), ignored -> true);
        assertEquals(List.of(1L, 2L), restored.stream().map(MatchmakingService.QueueEntry::userId).toList());

        MatchmakingService.QueueResult next = service.enqueueOrMatch(entry(3L, TimeControlType.RAPID), ignored -> true);
        assertEquals(1L, next.matchedEntry().userId());
    }

    @Test
    void cancellationDuringMatchCreationAbortsMatchAndRestoresOnlyTheOtherPlayer() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueResult first = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        service.commitQueuedEntry(first.queueReservationId());
        MatchmakingService.QueueResult paired = service.enqueueOrMatch(entry(2L, TimeControlType.RAPID), ignored -> true);

        assertEquals(MatchmakingService.CancelResult.CANCEL_REQUESTED, service.cancel(1L));
        assertFalse(service.beginCommit(paired.reservationId(), ignored -> true));
        List<MatchmakingService.QueueEntry> restored = service.rollbackMatch(paired.reservationId(), ignored -> true);
        assertEquals(List.of(2L), restored.stream().map(MatchmakingService.QueueEntry::userId).toList());
        assertEquals(MatchmakingService.CancelResult.CANCELED, service.cancel(2L));
        assertEquals(MatchmakingService.CancelResult.NOT_QUEUED, service.cancel(1L));
    }

    @Test
    void rollbackDoesNotRestoreDisconnectedOrOtherwiseIneligibleUsers() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueResult first = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        service.commitQueuedEntry(first.queueReservationId());
        MatchmakingService.QueueResult paired = service.enqueueOrMatch(entry(2L, TimeControlType.RAPID), ignored -> true);

        List<MatchmakingService.QueueEntry> restored = service.rollbackMatch(
                paired.reservationId(), candidate -> candidate.userId() == 2L);
        assertEquals(List.of(2L), restored.stream().map(MatchmakingService.QueueEntry::userId).toList());
    }

    @Test
    void stagedQueueEntryIsNotVisibleUntilCommitAndIsRemovedOnRollback() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueResult staged = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        MatchmakingService.QueueResult duplicate = service.enqueueOrMatch(entry(1L, TimeControlType.RAPID), ignored -> true);
        assertTrue(duplicate.alreadyQueued());
        MatchmakingService.QueueResult secondWaiting = service.enqueueOrMatch(entry(2L, TimeControlType.RAPID), ignored -> true);
        assertNotNull(secondWaiting.queueReservationId());
        service.commitQueuedEntry(secondWaiting.queueReservationId());

        service.rollbackQueuedEntry(staged.queueReservationId());
        assertEquals(MatchmakingService.CancelResult.NOT_QUEUED, service.cancel(1L));
        MatchmakingService.QueueResult second = service.enqueueOrMatch(entry(3L, TimeControlType.RAPID), ignored -> true);
        assertEquals(2L, second.matchedEntry().userId());
    }

    @Test
    void staleQueueEntryIsRemovedFromTheUserIndex() {
        MatchmakingService service = new MatchmakingService();
        MatchmakingService.QueueEntry stale = new MatchmakingService.QueueEntry(
                7L, TimeControlType.RAPID, Instant.now().minus(Duration.ofMinutes(4)));
        MatchmakingService.QueueResult staged = service.enqueueOrMatch(stale, ignored -> true);
        service.commitQueuedEntry(staged.queueReservationId());
        service.cleanup(Duration.ofMinutes(3));

        assertEquals(MatchmakingService.CancelResult.NOT_QUEUED, service.cancel(7L));
        MatchmakingService.QueueResult next = service.enqueueOrMatch(entry(8L, TimeControlType.RAPID), ignored -> true);
        assertEquals(8L, next.queuedEntry().userId());
    }

    private MatchmakingService.QueueEntry entry(Long userId, TimeControlType type) {
        return new MatchmakingService.QueueEntry(userId, type, Instant.now());
    }

    private MatchmakingService.QueueResult enqueueTogether(MatchmakingService service,
                                                            CountDownLatch ready,
                                                            CountDownLatch start,
                                                            Long userId,
                                                            TimeControlType type) throws InterruptedException {
        ready.countDown();
        assertTrue(start.await(2, TimeUnit.SECONDS));
        return service.enqueueOrMatch(entry(userId, type), ignored -> true);
    }
}
