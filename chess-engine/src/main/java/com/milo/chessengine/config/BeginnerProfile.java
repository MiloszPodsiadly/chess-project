package com.milo.chessengine.config;

/** Internal behavior tier for beginner play; this is not a measured rating. */
public record BeginnerProfile(
        int bandMax,
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
