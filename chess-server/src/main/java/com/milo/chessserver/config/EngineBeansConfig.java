package com.milo.chessserver.config;

import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.impl.ClassicEngine;
import com.milo.chessengine.impl.UciChessEngine;
import com.milo.chessengine.impl.UciEngineSettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;

@Configuration
public class EngineBeansConfig {

    @Bean
    public ChessEngine chessEngine(@Value("${chess.engine.uci.path:}") String enginePath,
                                   @Value("${chess.engine.uci.threads:2}") int threads,
                                   @Value("${chess.engine.uci.hash-mb:64}") int hashMb,
                                   @Value("${chess.engine.uci.multipv:5}") int multiPv,
                                   @Value("${chess.engine.uci.ready-timeout-ms:3000}") long readyTimeoutMs,
                                   @Value("${chess.engine.uci.search-timeout-ms:5000}") long searchTimeoutMs) {
        if (enginePath == null || enginePath.isBlank()) {
            return new ClassicEngine();
        }
        UciEngineSettings settings = new UciEngineSettings(
                enginePath,
                threads,
                hashMb,
                multiPv,
                readyTimeoutMs,
                searchTimeoutMs
        );
        return new UciChessEngine(settings);
    }
}
