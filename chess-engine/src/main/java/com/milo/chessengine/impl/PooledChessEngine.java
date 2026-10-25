package com.milo.chessengine.impl;

import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.Position;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.IntFunction;

/** A bounded set of independent UCI processes with a reserved analysis lane. */
public final class PooledChessEngine implements ChessEngine, AutoCloseable {
    private final List<UciChessEngine> all = new ArrayList<>();
    private final ArrayBlockingQueue<UciChessEngine> gameplay;
    private final ArrayBlockingQueue<UciChessEngine> analysis;
    private final Semaphore waiters;
    private final long acquisitionTimeoutMs;
    private final AtomicInteger active = new AtomicInteger();
    private final AtomicInteger queued = new AtomicInteger();
    private final AtomicLong crashes = new AtomicLong();
    private final AtomicLong timeouts = new AtomicLong();
    private final AtomicLong searches = new AtomicLong();
    private final AtomicLong lastDurationMs = new AtomicLong();
    private final AtomicInteger lastDepth = new AtomicInteger();
    private final AtomicLong lastNodes = new AtomicLong();
    private volatile boolean closed;

    public PooledChessEngine(UciEngineSettings settings, int instances, long acquisitionTimeoutMs) {
        this(instances, acquisitionTimeoutMs, index -> new UciChessEngine(settings));
    }

    PooledChessEngine(int instances, long acquisitionTimeoutMs, IntFunction<UciChessEngine> factory) {
        if (instances < 1) {
            throw new IllegalArgumentException("Engine instances must be positive");
        }
        int gameplayCount = Math.max(1, instances - 1);
        int analysisCount = instances - gameplayCount;
        this.gameplay = new ArrayBlockingQueue<>(gameplayCount);
        this.analysis = analysisCount == 0 ? null : new ArrayBlockingQueue<>(analysisCount);
        this.waiters = new Semaphore(Math.max(2, instances * 2));
        this.acquisitionTimeoutMs = acquisitionTimeoutMs;
        try {
            for (int i = 0; i < instances; i++) {
                UciChessEngine engine = factory.apply(i);
                all.add(engine);
                engine.verifyStartup();
                if (i < gameplayCount) {
                    gameplay.add(engine);
                } else {
                    analysis.add(engine);
                }
            }
        } catch (RuntimeException ex) {
            close();
            throw ex;
        }
    }

    @Override
    public EngineResult findBestMove(Position position, EngineConfig config) {
        return execute(gameplay, position, config, false);
    }

    @Override
    public EngineResult analyseFen(String fen, com.milo.chessdomain.Color sideToMove, EngineConfig config) {
        return analysePosition(new Position(fen, sideToMove), config);
    }

    public EngineResult analysePosition(Position position, EngineConfig config) {
        return execute(analysis == null ? gameplay : analysis, position, config, analysis == null);
    }

    private EngineResult execute(ArrayBlockingQueue<UciChessEngine> lane, Position position,
                                 EngineConfig config, boolean opportunistic) {
        if (closed) {
            throw new EngineUnavailableException("Engine pool is closed");
        }
        if (!waiters.tryAcquire()) {
            throw new EngineUnavailableException("Engine request queue is full");
        }
        UciChessEngine engine = null;
        queued.incrementAndGet();
        try {
            engine = opportunistic ? lane.poll() : lane.poll(acquisitionTimeoutMs, TimeUnit.MILLISECONDS);
            if (engine == null) {
                timeouts.incrementAndGet();
                throw new EngineUnavailableException("Timed out waiting for an engine process");
            }
            queued.decrementAndGet();
            active.incrementAndGet();
            try {
                EngineResult result = engine.findBestMove(position, config);
                searches.incrementAndGet();
                lastDurationMs.set(result.timeMillis());
                lastDepth.set(result.depthReached());
                lastNodes.set(result.nodes());
                return result;
            } catch (RuntimeException ex) {
                crashes.incrementAndGet();
                if (ex.getMessage() != null && ex.getMessage().toLowerCase().contains("timeout")) {
                    timeouts.incrementAndGet();
                }
                throw ex;
            } finally {
                active.decrementAndGet();
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new EngineUnavailableException("Interrupted while waiting for an engine process");
        } finally {
            if (engine != null && !closed) {
                lane.offer(engine);
            } else if (engine == null) {
                queued.decrementAndGet();
            }
            waiters.release();
        }
    }

    public boolean isRunning() {
        return !closed && all.stream().allMatch(UciChessEngine::isRunning);
    }

    public java.util.Map<String, Object> metrics() {
        long duration = lastDurationMs.get();
        return java.util.Map.ofEntries(
                java.util.Map.entry("engine", "Stockfish 19"),
                java.util.Map.entry("processes", all.size()),
                java.util.Map.entry("active", active.get()),
                java.util.Map.entry("queued", queued.get()),
                java.util.Map.entry("searches", searches.get()),
                java.util.Map.entry("crashes", crashes.get()),
                java.util.Map.entry("timeouts", timeouts.get()),
                java.util.Map.entry("lastDurationMs", duration),
                java.util.Map.entry("lastDepth", lastDepth.get()),
                java.util.Map.entry("lastNodes", lastNodes.get()),
                java.util.Map.entry("lastNps", duration > 0 ? lastNodes.get() * 1000 / duration : 0L));
    }

    @Override
    public synchronized void close() {
        if (closed) {
            return;
        }
        closed = true;
        all.forEach(UciChessEngine::close);
        gameplay.clear();
        if (analysis != null) {
            analysis.clear();
        }
    }
}
