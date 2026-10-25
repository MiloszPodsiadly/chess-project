package com.milo.chessengine.config;

/** Canonical server-side strength policy, independent of UI labels. */
public record EngineStrength(Mode mode, int elo, long timeBudgetMs, int depthCap, int multiPv) {
    public enum Mode { BEGINNER, TRAINING, FULL_STRENGTH, ANALYSIS }
    public enum Preset {
        STRONG(3_000), EXPERT(10_000), ULTIMATE(30_000), DEEP_CHALLENGE(60_000);
        private final long budgetMs;
        Preset(long budgetMs) { this.budgetMs = budgetMs; }
        public long budgetMs() { return budgetMs; }
    }

    public EngineStrength {
        if (mode == null || timeBudgetMs < 1 || multiPv < 1 || multiPv > 256 || depthCap < 0) {
            throw new IllegalArgumentException("Invalid engine strength settings");
        }
        if (mode == Mode.TRAINING && (elo < 1320 || elo > 3190)) {
            throw new IllegalArgumentException("Stockfish training Elo must be 1320..3190");
        }
        if (mode == Mode.BEGINNER && (elo < 200 || elo >= 1320)) {
            throw new IllegalArgumentException("Beginner level must be 200..1319");
        }
        if (mode == Mode.FULL_STRENGTH && (depthCap != 0 || multiPv != 1)) {
            throw new IllegalArgumentException("Full strength requires no depth cap and MultiPV=1");
        }
    }

    public static EngineStrength training(int elo, long timeBudgetMs) {
        return new EngineStrength(Mode.TRAINING, elo, timeBudgetMs, 0, 1);
    }

    public static EngineStrength beginner(int level, long timeBudgetMs, int depthCap, int multiPv) {
        return new EngineStrength(Mode.BEGINNER, level, timeBudgetMs, depthCap, multiPv);
    }

    public static EngineStrength full(Preset preset) {
        return new EngineStrength(Mode.FULL_STRENGTH, 0, preset.budgetMs(), 0, 1);
    }

    public static EngineStrength analysis(long timeBudgetMs, int depthCap, int multiPv) {
        return new EngineStrength(Mode.ANALYSIS, 0, timeBudgetMs, depthCap, multiPv);
    }

    public static EngineStrength fromElo(int elo, long timeBudgetMs, int depthCap) {
        if (elo < 200 || elo > 3190) {
            throw new IllegalArgumentException("Requested engine level must be 200..3190");
        }
        return elo >= 1320 ? training(elo, Math.max(1, timeBudgetMs))
                : beginner(elo, Math.max(1, timeBudgetMs), Math.max(0, depthCap),
                        Math.max(1, Math.min(5, EngineConfigMapper.forElo(elo).topMoves())));
    }
}
