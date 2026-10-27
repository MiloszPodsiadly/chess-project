package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

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
    void createsAndJoinsRoom() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        String code = service.createRoom(1L, "host", TimeControlType.RAPID, "Room", null, true);
        assertNotNull(code);

        MatchmakingService.JoinResult join = service.joinRoom(code, null);
        MatchmakingService.Room room = join.room();
        assertNotNull(room);
        assertEquals(1L, room.hostUserId());
    }

    @Test
    void cleanupRemovesOldRooms() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        String code = service.createRoom(1L, "host", TimeControlType.RAPID, "Room", null, true);
        assertNotNull(code);

        try {
            Thread.sleep(5);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
        service.cleanup(Duration.ZERO, Duration.ofMinutes(5));
        MatchmakingService.JoinResult join = service.joinRoom(code, null);
        assertNull(join.room());
    }

    @Test
    void privateRoomRequiresPassword() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        String code = service.createRoom(1L, "host", TimeControlType.RAPID, "Secret", "pass123", false);
        assertNotNull(code);

        MatchmakingService.JoinResult wrong = service.joinRoom(code, "bad");
        assertNull(wrong.room());
        assertEquals("bad_password", wrong.error());

        MatchmakingService.JoinResult ok = service.joinRoom(code, "pass123");
        assertNotNull(ok.room());
    }

    @Test
    void oneUserCanOnlyHoldOneQueuePositionAndCanCancelIt() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        MatchmakingService.QueueEntry first = entry(1L, TimeControlType.RAPID);
        assertEquals(first, service.enqueueOrMatch(first).queuedEntry());

        MatchmakingService.QueueResult duplicate = service.enqueueOrMatch(entry(1L, TimeControlType.BLITZ));
        assertTrue(duplicate.alreadyQueued());
        assertEquals(TimeControlType.RAPID, duplicate.queuedEntry().timeControlType());

        MatchmakingService.QueueResult paired = service.enqueueOrMatch(entry(2L, TimeControlType.RAPID));
        assertEquals(1L, paired.matchedEntry().userId());
        assertNull(paired.queuedEntry());
        assertFalse(service.cancel(1L));
    }

    @Test
    void simultaneousQueueRequestsForSameUserCreateOnePosition() throws Exception {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<MatchmakingService.QueueResult> first = executor.submit(() -> enqueueTogether(service, ready, start, 1L, TimeControlType.RAPID));
            Future<MatchmakingService.QueueResult> second = executor.submit(() -> enqueueTogether(service, ready, start, 1L, TimeControlType.BLITZ));
            assertTrue(ready.await(2, TimeUnit.SECONDS));
            start.countDown();
            List<MatchmakingService.QueueResult> results = List.of(first.get(2, TimeUnit.SECONDS), second.get(2, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter(result -> result.queuedEntry() != null && !result.alreadyQueued()).count());
            assertEquals(1, results.stream().filter(MatchmakingService.QueueResult::alreadyQueued).count());
            assertTrue(service.cancel(1L));
            assertFalse(service.cancel(1L));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void staleQueueEntryIsRemovedFromTheUserIndex() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        service.enqueueOrMatch(new MatchmakingService.QueueEntry(7L, TimeControlType.RAPID, Instant.now().minus(Duration.ofMinutes(10))));
        service.cleanup(Duration.ofMinutes(10), Duration.ofMinutes(5));

        assertFalse(service.cancel(7L));
        assertEquals(8L, service.enqueueOrMatch(entry(8L, TimeControlType.RAPID)).queuedEntry().userId());
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
        return service.enqueueOrMatch(entry(userId, type));
    }
}
