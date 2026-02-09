package com.milo.chessengine.impl;

import com.github.bhlangonijr.chesslib.Board;
import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.move.Move;
import com.github.bhlangonijr.chesslib.move.MoveGenerator;
import com.github.bhlangonijr.chesslib.move.MoveGeneratorException;
import com.milo.chessdomain.Color;
import com.milo.chessdomain.EvalType;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.ChessEngine;
import com.milo.chessengine.bot.BotMoveStrategy;
import com.milo.chessengine.bot.CandidateMove;
import com.milo.chessengine.config.EngineConfig;
import com.milo.chessengine.config.EngineConfigMapper;
import com.milo.chessengine.config.EloProfile;
import com.milo.chessengine.config.MoveSelection;
import com.milo.chessengine.core.EngineResult;
import com.milo.chessengine.core.EvalScore;
import com.milo.chessengine.core.Position;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

public class UciChessEngine implements ChessEngine, AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(UciChessEngine.class);

    private final UciEngineSettings settings;
    private final ReentrantLock lock = new ReentrantLock(true);
    private UciProcess process;
    private volatile boolean closed = false;

    public UciChessEngine(UciEngineSettings settings) {
        this.settings = Objects.requireNonNull(settings, "settings");
    }

    @Override
    public EngineResult findBestMove(Position position, EngineConfig config) {
        if (closed) {
            throw new IllegalStateException("Engine is closed");
        }
        lock.lock();
        try {
            ensureStarted();
            return search(position, config);
        } finally {
            lock.unlock();
        }
    }

    @Override
    public void close() {
        closed = true;
        if (process != null) {
            process.shutdown();
        }
    }

    private void ensureStarted() {
        if (process == null || !process.isAlive()) {
            process = new UciProcess(settings);
            process.start();
            initializeUci();
        }
    }

    private void initializeUci() {
        process.send("uci");
        process.waitFor("uciok", settings.readyTimeoutMs());
        if (settings.threads() > 0) {
            process.send("setoption name Threads value " + settings.threads());
        }
        if (settings.hashMb() > 0) {
            process.send("setoption name Hash value " + settings.hashMb());
        }
        if (settings.defaultMultiPv() > 1) {
            process.send("setoption name MultiPV value " + settings.defaultMultiPv());
        }
        process.send("isready");
        process.waitFor("readyok", settings.readyTimeoutMs());
    }

    private EngineResult search(Position position, EngineConfig config) {
        Instant started = Instant.now();
        EloProfile profile = EngineConfigMapper.forElo(config.engineElo());
        int multipvLimit = settings.defaultMultiPv() > 0 ? settings.defaultMultiPv() : 5;
        int multipv = profile.moveSelection() == MoveSelection.RANDOM_LEGAL
                ? multipvLimit
                : Math.max(1, Math.min(profile.topMoves(), multipvLimit));

        process.drain();
        process.send("ucinewgame");
        process.send("isready");
        process.waitFor("readyok", settings.readyTimeoutMs());

        if (multipv > 1) {
            process.send("setoption name MultiPV value " + multipv);
            process.send("isready");
            process.waitFor("readyok", settings.readyTimeoutMs());
        }

        process.send("position fen " + position.fen());

        int depthCap = Math.max(0, config.requestedDepth());
        long moveTime = Math.max(0L, config.hardTimeLimitMillis());
        if (moveTime > 0L) {
            process.send("go movetime " + moveTime);
        } else if (depthCap > 0) {
            process.send("go depth " + depthCap);
        } else {
            process.send("go movetime 50");
        }

        SearchCollector collector = new SearchCollector(position.sideToMove(), depthCap);
        long deadlineMs = settings.searchTimeoutMs();
        if (moveTime > 0) {
            deadlineMs = Math.max(deadlineMs, moveTime + 500);
        }
        Instant deadline = Instant.now().plusMillis(deadlineMs);

        boolean stopSent = false;
        while (Instant.now().isBefore(deadline)) {
            String line = process.pollLine(100);
            if (line == null) {
                continue;
            }
            if (line.startsWith("info ")) {
                collector.accept(line);
                if (depthCap > 0 && collector.maxDepth() >= depthCap && !stopSent) {
                    process.send("stop");
                    stopSent = true;
                }
            } else if (line.startsWith("bestmove")) {
                collector.acceptBestMove(line);
                break;
            }
        }

        if (!collector.hasBestMove()) {
            process.send("stop");
            Instant stopDeadline = Instant.now().plusMillis(300);
            while (Instant.now().isBefore(stopDeadline)) {
                String line = process.pollLine(100);
                if (line == null) {
                    continue;
                }
                if (line.startsWith("bestmove")) {
                    collector.acceptBestMove(line);
                    break;
                }
            }
        }

        SearchResult search = collector.toResult();
        CandidateMove chosen = chooseMove(position, profile, search);
        if (chosen == null) {
            return new EngineResult(
                    null,
                    List.of(),
                    EvalScore.cp(0, position.sideToMove()),
                    0,
                    0L,
                    Duration.between(started, Instant.now()).toMillis(),
                    search.candidates()
            );
        }

        long timeMs = Duration.between(started, Instant.now()).toMillis();
        return new EngineResult(
                chosen.move(),
                chosen.principalVariation(),
                chosen.score(),
                search.depthReached(),
                search.nodes(),
                timeMs,
                search.candidates()
        );
    }

    private CandidateMove chooseMove(Position position, EloProfile profile, SearchResult search) {
        if (profile.moveSelection() == MoveSelection.RANDOM_LEGAL) {
            List<CandidateMove> legal = generateLegalCandidates(position);
            CandidateMove choice = BotMoveStrategy.chooseMove(legal, profile);
            if (choice != null && search.score() != null) {
                return new CandidateMove(choice.move(), search.score(), choice.principalVariation());
            }
            return choice;
        }

        List<CandidateMove> candidates = search.candidates();
        CandidateMove choice = BotMoveStrategy.chooseMove(candidates, profile);
        if (choice != null) {
            return choice;
        }
        if (search.bestMove() != null) {
            return new CandidateMove(search.bestMove(), search.score(), search.principalVariation());
        }
        return null;
    }

    private List<CandidateMove> generateLegalCandidates(Position position) {
        Board board = new Board();
        try {
            board.loadFromFen(position.fen());
        } catch (Exception ex) {
            return List.of();
        }
        List<Move> legalMoves;
        try {
            legalMoves = MoveGenerator.generateLegalMoves(board);
        } catch (MoveGeneratorException ex) {
            return List.of();
        }
        List<CandidateMove> candidates = new ArrayList<>(legalMoves.size());
        for (Move move : legalMoves) {
            MoveDto dto = toMoveDto(move.getFrom().value(), move.getTo().value(), move.getPromotion(), position.sideToMove());
            candidates.add(new CandidateMove(dto, EvalScore.cp(0, position.sideToMove()), List.of(dto)));
        }
        return candidates;
    }

    private static MoveDto toMoveDto(String from, String to, Piece promotion, Color side) {
        String promo = null;
        if (promotion != null && promotion != Piece.NONE) {
            promo = switch (promotion.getPieceType()) {
                case QUEEN -> "q";
                case ROOK -> "r";
                case BISHOP -> "b";
                case KNIGHT -> "n";
                case PAWN -> "p";
                case KING -> "k";
                default -> null;
            };
        }
        return new MoveDto(from.toLowerCase(Locale.ROOT), to.toLowerCase(Locale.ROOT), promo, side);
    }

    private static MoveDto toMoveDto(String uci, Color side) {
        if (uci == null || uci.length() < 4) {
            return null;
        }
        String from = uci.substring(0, 2);
        String to = uci.substring(2, 4);
        String promo = uci.length() > 4 ? String.valueOf(uci.charAt(4)) : null;
        return new MoveDto(from.toLowerCase(Locale.ROOT), to.toLowerCase(Locale.ROOT), promo, side);
    }

    private static List<MoveDto> toPvMoves(List<String> pvMoves, Color startSide) {
        List<MoveDto> moves = new ArrayList<>();
        if (pvMoves == null || pvMoves.isEmpty()) {
            return moves;
        }
        Color side = startSide;
        for (String uci : pvMoves) {
            MoveDto move = toMoveDto(uci, side);
            if (move == null) {
                break;
            }
            moves.add(move);
            side = side == Color.WHITE ? Color.BLACK : Color.WHITE;
        }
        return moves;
    }

    private static EvalScore toEvalScore(Color side, EvalType type, int value) {
        if (type == EvalType.MATE) {
            return EvalScore.mate(value, side);
        }
        return EvalScore.cp(value, side);
    }

    private record SearchCandidate(int depth, EvalScore score, List<MoveDto> pv) {}

    private record SearchResult(
            MoveDto bestMove,
            List<MoveDto> principalVariation,
            EvalScore score,
            int depthReached,
            long nodes,
            List<CandidateMove> candidates
    ) {}

    private final class SearchCollector {

        private final Color sideToMove;
        private final int depthCap;
        private final Map<Integer, SearchCandidate> perMultipv = new HashMap<>();
        private MoveDto bestMove;
        private long nodes;
        private int maxDepth;
        private EvalScore bestScore;
        private List<MoveDto> bestPv = List.of();

        private SearchCollector(Color sideToMove, int depthCap) {
            this.sideToMove = sideToMove;
            this.depthCap = depthCap;
        }

        void accept(String line) {
            String[] tokens = line.split("\\s+");
            int depth = -1;
            int multipv = 1;
            EvalType scoreType = null;
            Integer scoreValue = null;
            List<String> pvMoves = null;

            for (int i = 1; i < tokens.length; i++) {
                switch (tokens[i]) {
                    case "depth" -> {
                        if (i + 1 < tokens.length) {
                            depth = parseInt(tokens[++i]);
                        }
                    }
                    case "multipv" -> {
                        if (i + 1 < tokens.length) {
                            multipv = parseInt(tokens[++i]);
                        }
                    }
                    case "score" -> {
                        if (i + 2 < tokens.length) {
                            String type = tokens[++i];
                            scoreType = "mate".equals(type) ? EvalType.MATE : EvalType.CP;
                            scoreValue = parseInt(tokens[++i]);
                        }
                    }
                    case "pv" -> {
                        if (i + 1 < tokens.length) {
                            pvMoves = new ArrayList<>();
                            for (int j = i + 1; j < tokens.length; j++) {
                                pvMoves.add(tokens[j]);
                            }
                        }
                        i = tokens.length;
                    }
                    case "nodes" -> {
                        if (i + 1 < tokens.length) {
                            nodes = parseLong(tokens[++i]);
                        }
                    }
                    default -> {
                    }
                }
            }

            if (depth > maxDepth) {
                maxDepth = depth;
            }
            if (depthCap > 0 && depth > depthCap) {
                return;
            }

            if (scoreType == null || scoreValue == null) {
                return;
            }
            EvalScore score = toEvalScore(sideToMove, scoreType, scoreValue);
            List<MoveDto> pv = toPvMoves(pvMoves, sideToMove);
            if (pv.isEmpty()) {
                return;
            }

            SearchCandidate existing = perMultipv.get(multipv);
            if (existing == null || depth >= existing.depth()) {
                perMultipv.put(multipv, new SearchCandidate(depth, score, pv));
            }

            if (multipv == 1) {
                bestScore = score;
                bestPv = pv;
            }
        }

        void acceptBestMove(String line) {
            String[] tokens = line.split("\\s+");
            if (tokens.length >= 2) {
                bestMove = toMoveDto(tokens[1], sideToMove);
            }
        }

        boolean hasBestMove() {
            return bestMove != null;
        }

        int maxDepth() {
            return maxDepth;
        }

        SearchResult toResult() {
            List<CandidateMove> candidates = new ArrayList<>();
            for (SearchCandidate candidate : perMultipv.values()) {
                if (candidate.pv().isEmpty()) {
                    continue;
                }
                MoveDto move = candidate.pv().get(0);
                candidates.add(new CandidateMove(move, candidate.score(), candidate.pv()));
            }
            return new SearchResult(
                    bestMove,
                    bestPv,
                    Optional.ofNullable(bestScore).orElse(EvalScore.cp(0, sideToMove)),
                    Math.max(0, maxDepth),
                    nodes,
                    candidates
            );
        }
    }

    private static int parseInt(String token) {
        try {
            return Integer.parseInt(token);
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private static long parseLong(String token) {
        try {
            return Long.parseLong(token);
        } catch (NumberFormatException ex) {
            return 0L;
        }
    }

    private static final class UciProcess {
        private final UciEngineSettings settings;
        private final BlockingQueue<String> output = new LinkedBlockingQueue<>();
        private Process process;
        private BufferedWriter writer;

        private UciProcess(UciEngineSettings settings) {
            this.settings = settings;
        }

        boolean isAlive() {
            return process != null && process.isAlive();
        }

        void start() {
            try {
                ProcessBuilder builder = new ProcessBuilder(settings.executablePath());
                builder.redirectErrorStream(true);
                process = builder.start();
                writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
                startReader(process);
            } catch (IOException ex) {
                throw new IllegalStateException("Failed to start UCI engine", ex);
            }
        }

        void startReader(Process process) {
            Thread reader = new Thread(() -> {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        output.offer(line);
                    }
                } catch (IOException ex) {
                    log.warn("UCI engine reader stopped", ex);
                }
            }, "uci-engine-reader");
            reader.setDaemon(true);
            reader.start();
        }

        void send(String command) {
            try {
                writer.write(command);
                writer.newLine();
                writer.flush();
            } catch (IOException ex) {
                throw new IllegalStateException("Failed to send command to UCI engine", ex);
            }
        }

        void waitFor(String token, long timeoutMs) {
            Instant deadline = Instant.now().plusMillis(timeoutMs);
            while (Instant.now().isBefore(deadline)) {
                String line = pollLine(100);
                if (line == null) {
                    continue;
                }
                if (line.trim().equals(token)) {
                    return;
                }
            }
            throw new IllegalStateException("Timeout waiting for UCI token: " + token);
        }

        void drain() {
            output.clear();
        }

        String pollLine(long timeoutMs) {
            try {
                return output.poll(timeoutMs, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return null;
            }
        }

        void shutdown() {
            if (process != null) {
                process.destroy();
            }
        }
    }
}
