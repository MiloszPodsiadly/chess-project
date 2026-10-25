package com.milo.chessengine.impl;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.EvalScore;
import com.milo.chessengine.core.Position;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class PooledChessEngineTest {
    private static final Position START = new Position(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", Color.WHITE);
    private static final EngineConfig CONFIG = EngineConfigMapper.toEngineConfig(1200, Color.WHITE);

    @Test
    void gameplayCompletesWhileAnalysisLaneIsOccupied() throws Exception {
        CountDownLatch analysisStarted = new CountDownLatch(1);
        CountDownLatch releaseAnalysis = new CountDownLatch(1);
        try (PooledChessEngine pool = new PooledChessEngine(2, 200, index ->
                new FakeEngine(() -> {
                    if (index == 1) {
                        analysisStarted.countDown();
                        await(releaseAnalysis);
                    }
                    return result();
                }));
             var executor = Executors.newSingleThreadExecutor()) {
            var analysis = executor.submit(() -> pool.analysePosition(START, CONFIG));
            assertTrue(analysisStarted.await(1, TimeUnit.SECONDS));
            assertEquals("e2", pool.findBestMove(START, CONFIG).bestMove().from());
            releaseAnalysis.countDown();
            assertNotNull(analysis.get(1, TimeUnit.SECONDS));
        }
    }

    @Test
    void boundedQueueRejectsExcessAndRecoversAfterRelease() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (PooledChessEngine pool = new PooledChessEngine(1, 500, index ->
                new FakeEngine(() -> {
                    started.countDown();
                    await(release);
                    return result();
                }));
             var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> pool.findBestMove(START, CONFIG));
            assertTrue(started.await(1, TimeUnit.SECONDS));
            var second = executor.submit(() -> pool.findBestMove(START, CONFIG));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
            while (((Number) pool.metrics().get("queued")).intValue() == 0 && System.nanoTime() < deadline) {
                Thread.yield();
            }
            assertEquals(1, pool.metrics().get("queued"));
            assertThrows(EngineUnavailableException.class, () -> pool.findBestMove(START, CONFIG));
            release.countDown();
            assertNotNull(first.get(1, TimeUnit.SECONDS));
            assertNotNull(second.get(1, TimeUnit.SECONDS));
        }
    }

    @Test
    void failedSearchReleasesSlotAndShutdownClosesProcess() {
        AtomicInteger calls = new AtomicInteger();
        AtomicBoolean closed = new AtomicBoolean();
        PooledChessEngine pool = new PooledChessEngine(1, 100, index ->
                new FakeEngine(() -> {
                    if (calls.getAndIncrement() == 0) {
                        throw new IllegalStateException("simulated crash");
                    }
                    return result();
                }, closed));
        assertThrows(IllegalStateException.class, () -> pool.findBestMove(START, CONFIG));
        assertNotNull(pool.findBestMove(START, CONFIG));
        assertEquals(1L, pool.metrics().get("crashes"));
        pool.close();
        assertTrue(closed.get());
        assertThrows(EngineUnavailableException.class, () -> pool.findBestMove(START, CONFIG));
    }

    @Test
    void cancelledSearchDoesNotHoldTheSlot() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch neverReleased = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        try (PooledChessEngine pool = new PooledChessEngine(1, 200, index ->
                new FakeEngine(() -> {
                    if (calls.getAndIncrement() == 0) {
                        started.countDown();
                        await(neverReleased);
                    }
                    return result();
                }));
             var executor = Executors.newSingleThreadExecutor()) {
            var pending = executor.submit(() -> pool.findBestMove(START, CONFIG));
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertTrue(pending.cancel(true));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
            while (((Number) pool.metrics().get("active")).intValue() != 0 && System.nanoTime() < deadline) {
                Thread.yield();
            }
            assertEquals("e2", pool.findBestMove(START, CONFIG).bestMove().from());
        }
    }

    private static EngineResult result() {
        MoveDto move = new MoveDto("e2", "e4", null, Color.WHITE);
        return new EngineResult(move, List.of(move), EvalScore.cp(20, Color.WHITE), 1, 20, 1, List.of());
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(2, TimeUnit.SECONDS)) {
                throw new IllegalStateException("timed out waiting for test latch");
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }

    private static final class FakeEngine extends UciChessEngine {
        private final java.util.function.Supplier<EngineResult> search;
        private final AtomicBoolean closed;

        private FakeEngine(java.util.function.Supplier<EngineResult> search) {
            this(search, new AtomicBoolean());
        }

        private FakeEngine(java.util.function.Supplier<EngineResult> search, AtomicBoolean closed) {
            super(new UciEngineSettings("unused", 1, 16, 1, 100, 100));
            this.search = search;
            this.closed = closed;
        }

        @Override public String verifyStartup() { return "Stockfish 19"; }
        @Override public boolean isRunning() { return !closed.get(); }
        @Override public EngineResult findBestMove(Position position, EngineConfig config) { return search.get(); }
        @Override public void close() { closed.set(true); }
    }
}
