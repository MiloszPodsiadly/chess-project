package com.milo.chessserver.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Configuration
@EnableScheduling
public class EngineTurnExecutorConfig {
    @Bean(destroyMethod = "shutdownNow")
    ExecutorService engineTurnExecutor() {
        int workers = Math.min(2, Math.max(1, Runtime.getRuntime().availableProcessors()));
        return new ThreadPoolExecutor(workers, workers, 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(2), runnable -> {
            Thread thread = new Thread(runnable, "engine-turn");
            thread.setDaemon(true);
            return thread;
        }, new ThreadPoolExecutor.AbortPolicy());
    }
}
