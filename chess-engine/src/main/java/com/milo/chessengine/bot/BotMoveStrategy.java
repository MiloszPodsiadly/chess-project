package com.milo.chessengine.bot;

import com.milo.chessengine.config.BeginnerProfile;
import com.milo.chessengine.config.MoveSelection;
import com.milo.chessdomain.EvalType;

import java.security.SecureRandom;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

public final class BotMoveStrategy {

    private static final Random RNG = new SecureRandom();

    private BotMoveStrategy() {}

    public static CandidateMove chooseMove(List<CandidateMove> candidates, BeginnerProfile profile) {
        if (candidates == null || candidates.isEmpty()) {
            return null;
        }

        List<CandidateMove> ordered = candidates.stream()
                .sorted(Comparator.comparingInt(BotMoveStrategy::scoreForOrdering))
                .toList();

        boolean blunder = RNG.nextDouble() < profile.blunderProb();
        MoveSelection selection = profile.moveSelection();

        if (selection == MoveSelection.RANDOM_LEGAL) {
            return candidates.get(RNG.nextInt(candidates.size()));
        }

        int topN = Math.max(1, profile.topMoves());
        List<CandidateMove> top = ordered.subList(Math.max(0, ordered.size() - topN), ordered.size());
        top = maybeMissMate(top, profile);

        if (selection == MoveSelection.RANDOM_TOP_N) {
            if (blunder && ordered.size() > top.size()) {
                return ordered.get(RNG.nextInt(ordered.size() - top.size()));
            }
            return top.get(RNG.nextInt(top.size()));
        }

        if (selection == MoveSelection.TOP_N) {
            if (blunder && top.size() > 1) {
                return top.get(RNG.nextInt(top.size()));
            }
            return top.get(top.size() - 1);
        }

        if (selection == MoveSelection.BEST_OR_TOP2) {
            if (top.size() >= 2 && RNG.nextDouble() < 0.15) {
                return top.get(top.size() - 2);
            }
            return top.get(top.size() - 1);
        }

        return top.get(top.size() - 1);
    }

    private static int scoreForOrdering(CandidateMove candidate) {
        if (candidate.score() == null) {
            return Integer.MIN_VALUE;
        }
        if (candidate.score().type() == EvalType.MATE) {
            int ply = candidate.score().value();
            if (ply > 0) {
                return 100000 - ply;
            }
            return -100000 - ply;
        }
        return candidate.score().value();
    }

    private static List<CandidateMove> maybeMissMate(List<CandidateMove> top, BeginnerProfile profile) {
        if (top.size() <= 1) {
            return top;
        }
        CandidateMove best = top.get(top.size() - 1);
        if (best.score() == null || best.score().type() != EvalType.MATE) {
            return top;
        }
        if (best.score().value() <= 0) {
            return top;
        }
        if (RNG.nextDouble() >= profile.mateMissProb()) {
            return top;
        }
        return top.subList(0, top.size() - 1);
    }
}
