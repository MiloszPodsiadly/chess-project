package com.milo.chessengine.impl;

public record UciEngineSettings(
        String executablePath,
        int threads,
        int hashMb,
        int defaultMultiPv,
        long readyTimeoutMs,
        long searchTimeoutMs
) {}
