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
        int effectiveThreads = threads > 0 ? Math.min(threads, cpuLimit) : 1;
        long heapMb = Math.max(16L, Runtime.getRuntime().maxMemory() / (1024L * 1024L));
        int effectiveHashMb = hashMb > 0 ? hashMb : (int) Math.max(16L, Math.min(64L, heapMb / 4L));
        int autoInstances = cpuLimit >= 2 && heapMb >= 512 ? 2 : 1;
        int effectiveInstances = instances > 0 ? Math.min(instances, cpuLimit) : autoInstances;
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
            log.info("Verified Stockfish 19 engine pool with {} process(es)", effectiveInstances);
            return engine;
        } catch (RuntimeException ex) {
            log.error("Stockfish startup verification failed", ex);
            return new UnavailableChessEngine(ex.getMessage());
        }
    }
}
