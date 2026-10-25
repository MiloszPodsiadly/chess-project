package com.milo.chessserver.config;

import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.impl.UnavailableChessEngine;
import com.milo.chessengine.impl.UciChessEngine;
import com.milo.chessengine.impl.PooledChessEngine;
import com.milo.chessengine.impl.UciEngineSettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.file.Files;
import java.nio.file.Path;

@Configuration
public class EngineBeansConfig {
    private static final Logger log = LoggerFactory.getLogger(EngineBeansConfig.class);

    @Bean(destroyMethod = "close")
    public ChessEngine chessEngine(@Value("${chess.engine.uci.path:}") String enginePath,
                                   @Value("${chess.engine.uci.threads:0}") int threads,
                                   @Value("${chess.engine.uci.hash-mb:0}") int hashMb,
                                   @Value("${chess.engine.uci.multipv:5}") int multiPv,
                                   @Value("${chess.engine.uci.engine-instances:0}") int instances,
                                   @Value("${chess.engine.uci.acquire-timeout-ms:1000}") long acquireTimeoutMs,
                                   @Value("${chess.engine.uci.ready-timeout-ms:3000}") long readyTimeoutMs,
                                   @Value("${chess.engine.uci.search-timeout-ms:5000}") long searchTimeoutMs) {
        if (enginePath == null || enginePath.isBlank()) {
            return new UnavailableChessEngine("STOCKFISH_PATH is not configured");
        }
        int cpuLimit = Math.max(1, Runtime.getRuntime().availableProcessors());
        long heapMb = Math.max(16L, Runtime.getRuntime().maxMemory() / (1024L * 1024L));
        long memoryMb = containerMemoryMb(heapMb);
        if (memoryMb < heapMb + 256L) {
            return new UnavailableChessEngine("Insufficient container memory for Stockfish");
        }
        long nativeBudgetMb = Math.max(128L, memoryMb - heapMb - 192L);
        int autoInstances = cpuLimit >= 2 && nativeBudgetMb >= 384 ? 2 : 1;
        int effectiveInstances = instances > 0 ? Math.min(instances, Math.min(cpuLimit, 2)) : autoInstances;
        int effectiveThreads = threads > 0 ? Math.min(threads, Math.max(1, cpuLimit / effectiveInstances)) : 1;
        int perProcessBudgetMb = (int) Math.max(64L, nativeBudgetMb / effectiveInstances);
        int maxHashMb = Math.max(16, perProcessBudgetMb - 96);
        int effectiveHashMb = hashMb > 0 ? Math.min(hashMb, maxHashMb) : Math.min(64, maxHashMb);
        if (hashMb > effectiveHashMb || threads > effectiveThreads || instances > effectiveInstances) {
            log.warn("Stockfish settings constrained by container CPU/memory budget: processes={}, threads/process={}, hash/process={} MB",
                    effectiveInstances, effectiveThreads, effectiveHashMb);
        }
        UciEngineSettings settings = new UciEngineSettings(
                enginePath,
                effectiveThreads,
                effectiveHashMb,
                multiPv,
                readyTimeoutMs,
                searchTimeoutMs
        );
        try {
            PooledChessEngine engine = new PooledChessEngine(settings, effectiveInstances, acquireTimeoutMs);
            log.info("Verified Stockfish 19 engine pool with {} process(es), {} thread(s)/process and {} MB hash/process ({} MB container budget)",
                    effectiveInstances, effectiveThreads, effectiveHashMb, memoryMb);
            return engine;
        } catch (RuntimeException ex) {
            log.error("Stockfish startup verification failed", ex);
            return new UnavailableChessEngine(ex.getMessage());
        }
    }

    private static long containerMemoryMb(long heapMb) {
        for (String file : new String[]{"/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"}) {
            try {
                String value = Files.readString(Path.of(file)).trim();
                if (!"max".equals(value)) {
                    long bytes = Long.parseLong(value);
                    if (bytes > 0 && bytes < Long.MAX_VALUE / 2) return bytes / (1024L * 1024L);
                }
            } catch (Exception ignored) {
                // Local development may have no cgroup memory controller.
            }
        }
        return Math.max(1024L, heapMb * 4);
    }
}
