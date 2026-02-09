package com.milo.chessengine.config;

public record EloProfile(
        int elo,
        long minTimeMillis,
        long maxTimeMillis,
        int depthCap,
        int topMoves,
        MoveSelection moveSelection,
        double blunderProb,
        double mateMissProb
) {

    public long pickTimeMillis(long randomValue) {
        if (minTimeMillis >= maxTimeMillis) {
            return minTimeMillis;
        }
        long range = maxTimeMillis - minTimeMillis;
        long offset = Math.floorMod(randomValue, range + 1);
        return minTimeMillis + offset;
    }
}
