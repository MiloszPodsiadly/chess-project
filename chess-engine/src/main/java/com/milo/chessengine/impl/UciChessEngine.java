package com.milo.chessengine.impl;

import com.github.bhlangonijr.chesslib.Board;
import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.Side;
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
import com.milo.chessengine.config.EngineStrength;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CancellationException;
import java.util.concurrent.locks.ReentrantLock;
import java.util.UUID;

public class UciChessEngine implements ChessEngine, AutoCloseable {

    public enum State { STARTING, INITIALIZING, READY, SEARCHING, STOPPING, FAILED, CLOSED }

    private static final Logger log = LoggerFactory.getLogger(UciChessEngine.class);

    private final UciEngineSettings settings;
    private final ReentrantLock lock = new ReentrantLock(true);
    private UciProcess process;
    private volatile boolean closed = false;
    private volatile String engineName;
    private Map<String, String> uciOptions = Map.of();
    private volatile State state = State.STARTING;
    private long processGeneration;
    private String currentGameId;

    public UciChessEngine(UciEngineSettings settings) {
        this.settings = Objects.requireNonNull(settings, "settings");
    }

    /** Proves that the configured binary is Stockfish 19 and can complete a real search. */
    public String verifyStartup() {
        lock.lock();
        try {
            ensureStarted();
            process.send("position startpos");
            process.send("go depth 1");
            state = State.SEARCHING;
            Instant deadline = Instant.now().plusMillis(settings.searchTimeoutMs());
            boolean sawNnue = false;
            while (Instant.now().isBefore(deadline)) {
                String line = process.pollLine(100);
                if (line == null) {
                    continue;
                }
                if (line.toLowerCase(Locale.ROOT).contains("nnue")) {
                    sawNnue = true;
                }
                if (line.startsWith("bestmove ")) {
                    if (!line.matches("bestmove [a-h][1-8][a-h][1-8][qrbn]?($| .*)")) {
                        throw new IllegalStateException("Stockfish returned an invalid bestmove: " + line);
                    }
                    if (!sawNnue) {
                        throw new IllegalStateException("Stockfish search did not confirm NNUE initialization");
                    }
                    state = State.READY;
                    return engineName;
                }
            }
            process.send("stop");
            state = State.STOPPING;
            throw new IllegalStateException("Stockfish startup search timed out");
        } catch (RuntimeException ex) {
            failProcess();
            throw ex;
        } finally {
            lock.unlock();
        }
    }

    public boolean isRunning() {
        return !closed && process != null && process.isAlive() && state != State.FAILED;
    }

    public State state() { return state; }
    public String engineName() { return engineName; }
    public long processGeneration() { return processGeneration; }

    @Override
    public EngineResult findBestMove(Position position, EngineConfig config) {
        validatePosition(position);
        if (closed) {
            throw new IllegalStateException("Engine is closed");
        }
        lock.lock();
        try {
            ensureStarted();
            return search(position, config);
        } catch (RuntimeException ex) {
            failProcess();
            throw ex;
        } finally {
            lock.unlock();
        }
    }

    @Override
    public void close() {
        lock.lock();
        try {
            closed = true;
            if (process != null) {
                process.shutdown();
                process = null;
            }
            state = State.CLOSED;
        } finally {
            lock.unlock();
        }
    }

    private void failProcess() {
        if (process != null) {
            process.shutdown();
            process = null;
        }
        currentGameId = null;
        state = closed ? State.CLOSED : State.FAILED;
    }

    private void ensureStarted() {
        if (process == null || !process.isAlive()) {
            state = State.STARTING;
            process = new UciProcess(settings);
            try {
                process.start();
                processGeneration++;
                state = State.INITIALIZING;
                initializeUci();
                state = State.READY;
            } catch (RuntimeException ex) {
                failProcess();
                throw ex;
            }
        }
    }

    private void initializeUci() {
        process.send("uci");
        UciIdentity identity = process.waitForIdentity(settings.readyTimeoutMs());
        engineName = identity.name();
        uciOptions = identity.options();
        if (!engineName.matches("Stockfish 19(?:\\s.*)?")) {
            throw new IllegalStateException("Expected Stockfish 19, got: " + engineName);
        }
        for (String option : List.of("Threads", "Hash", "MultiPV", "Skill Level", "UCI_LimitStrength", "UCI_Elo")) {
            if (!uciOptions.containsKey(option)) {
                throw new IllegalStateException("Stockfish is missing UCI option: " + option);
            }
        }
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
        SearchRequest request = new SearchRequest(UUID.randomUUID(), position.fen(), processGeneration);
        EngineStrength strength = Objects.requireNonNull(config.strength(), "strength");
        EloProfile profile = strength.mode() == EngineStrength.Mode.BEGINNER
                ? EngineConfigMapper.forElo(strength.elo()) : null;
        int multipvLimit = settings.defaultMultiPv() > 0 ? settings.defaultMultiPv() : 5;
        int multipv = Math.max(1, Math.min(strength.multiPv(), multipvLimit));

        process.drain();
        if (position.gameId() == null || !position.gameId().equals(currentGameId)) {
            process.send("ucinewgame");
            process.send("isready");
            process.waitFor("readyok", settings.readyTimeoutMs());
            currentGameId = position.gameId();
        }
        configureStrength(strength);
        process.send("setoption name MultiPV value " + multipv);
        process.send("isready");
        process.waitFor("readyok", settings.readyTimeoutMs());

        if (position.movesFromStart().isEmpty()) {
            process.send("position fen " + position.fen());
        } else {
            process.send("position startpos moves " + String.join(" ", position.movesFromStart()));
        }

        int depthCap = strength.depthCap();
        long moveTime = strength.timeBudgetMs();
        if (moveTime > 0L) {
            process.send("go movetime " + moveTime);
        } else if (depthCap > 0) {
            process.send("go depth " + depthCap);
        } else {
            process.send("go movetime 50");
        }
        state = State.SEARCHING;

        SearchCollector collector = new SearchCollector(position.sideToMove(), depthCap, multipv);
        long deadlineMs = settings.searchTimeoutMs();
        if (moveTime > 0) {
            deadlineMs = Math.max(deadlineMs, moveTime + 500);
        }
        Instant deadline = Instant.now().plusMillis(deadlineMs);

        boolean stopSent = false;
        while (Instant.now().isBefore(deadline)) {
            if (request.processGeneration() != processGeneration) {
                throw new IllegalStateException("UCI process generation changed during search " + request.id());
            }
            String line = process.pollLine(100);
            if (line == null) {
                continue;
            }
            if (line.startsWith("info ")) {
                collector.accept(line);
                if (depthCap > 0 && collector.maxDepth() >= depthCap && !stopSent) {
                    process.send("stop");
                    state = State.STOPPING;
                    stopSent = true;
                }
            } else if (line.startsWith("bestmove")) {
                collector.acceptBestMove(line);
                break;
            }
        }

        if (!collector.hasBestMove()) {
            log.warn("Stopping search {} for position {} after deadline", request.id(), request.fen());
            process.send("stop");
            state = State.STOPPING;
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

        if (!collector.hasBestMove()) {
            throw new IllegalStateException("Stockfish search ended without bestmove");
        }

        SearchResult search = collector.toResult();
        if (search.bestMove() == null) {
            state = State.READY;
            return new EngineResult(null, List.of(), search.score(), search.depthReached(),
                    search.nodes(), Duration.between(started, Instant.now()).toMillis(), List.of());
        }
        CandidateMove chosen = profile == null
                ? new CandidateMove(search.bestMove(), search.score(), search.principalVariation())
                : chooseMove(position, profile, search);
        if (chosen == null || !isLegalMove(position, chosen.move())) {
            throw new IllegalStateException("Stockfish returned no legal move");
        }

        long timeMs = Duration.between(started, Instant.now()).toMillis();
        state = State.READY;
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

    private void configureStrength(EngineStrength strength) {
        if (strength.mode() == EngineStrength.Mode.TRAINING) {
            String eloOption = uciOptions.get("UCI_Elo");
            java.util.regex.Matcher range = java.util.regex.Pattern.compile("min (\\d+) max (\\d+)").matcher(eloOption);
            if (!range.find() || strength.elo() < Integer.parseInt(range.group(1))
                    || strength.elo() > Integer.parseInt(range.group(2))) {
                throw new IllegalArgumentException("Requested Elo is unsupported by this Stockfish binary");
            }
            process.send("setoption name Skill Level value 20");
            process.send("setoption name UCI_Elo value " + strength.elo());
            process.send("setoption name UCI_LimitStrength value true");
        } else {
            process.send("setoption name UCI_LimitStrength value false");
            int skill = strength.mode() == EngineStrength.Mode.BEGINNER
                    ? Math.max(0, Math.min(10, (strength.elo() - 200) / 100)) : 20;
            process.send("setoption name Skill Level value " + skill);
        }
    }

    private boolean isLegalMove(Position position, MoveDto move) {
        return generateLegalCandidates(position).stream().anyMatch(candidate ->
                candidate.move().from().equals(move.from())
                        && candidate.move().to().equals(move.to())
                        && Objects.equals(candidate.move().promotion(), move.promotion()));
    }

    private static void validatePosition(Position position) {
        if (position == null || position.fen() == null || position.sideToMove() == null) {
            throw new IllegalArgumentException("Position, FEN, and side to move are required");
        }
        Board board = new Board();
        try {
            board.loadFromFen(position.fen());
            if ((board.getSideToMove() == Side.WHITE) != (position.sideToMove() == Color.WHITE)) {
                throw new IllegalArgumentException("FEN side to move does not match request");
            }
            if (!position.movesFromStart().isEmpty()) {
                Board historyBoard = new Board();
                for (String uci : position.movesFromStart()) {
                    if (uci == null || !uci.matches("[a-h][1-8][a-h][1-8][qrbn]?")) {
                        throw new IllegalArgumentException("Invalid move in history: " + uci);
                    }
                    String from = uci.substring(0, 2);
                    String to = uci.substring(2, 4);
                    String promotion = uci.length() == 5 ? uci.substring(4) : null;
                    Move legalMove = MoveGenerator.generateLegalMoves(historyBoard).stream()
                            .filter(move -> move.getFrom().value().equalsIgnoreCase(from)
                                    && move.getTo().value().equalsIgnoreCase(to)
                                    && Objects.equals(promotionCode(move.getPromotion()), promotion))
                            .findFirst().orElseThrow(() -> new IllegalArgumentException("Illegal move in history: " + uci));
                    historyBoard.doMove(legalMove);
                }
                String expected = String.join(" ", java.util.Arrays.copyOf(board.getFen().split(" "), 4));
                String actual = String.join(" ", java.util.Arrays.copyOf(historyBoard.getFen().split(" "), 4));
                if (!expected.equals(actual)) {
                    throw new IllegalArgumentException("Move history does not match FEN");
                }
            }
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalArgumentException("Invalid chess position", ex);
        }
    }

    private static String promotionCode(Piece promotion) {
        if (promotion == null || promotion == Piece.NONE) {
            return null;
        }
        return switch (promotion.getPieceType()) {
            case QUEEN -> "q";
            case ROOK -> "r";
            case BISHOP -> "b";
            case KNIGHT -> "n";
            default -> null;
        };
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
            candidates.add(new CandidateMove(dto, null, List.of(dto)));
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
        if (uci == null || !uci.matches("[a-h][1-8][a-h][1-8][qrbn]?")) {
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
    private record SearchRequest(UUID id, String fen, long processGeneration) {}
    private record UciIdentity(String name, Map<String, String> options) {}

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
        private final int expectedMultiPv;
        private final Map<Integer, Map<Integer, SearchCandidate>> snapshots = new TreeMap<>();
        private MoveDto bestMove;
        private boolean bestMoveReceived;
        private long nodes;
        private int maxDepth;

        private SearchCollector(Color sideToMove, int depthCap, int expectedMultiPv) {
            this.sideToMove = sideToMove;
            this.depthCap = depthCap;
            this.expectedMultiPv = expectedMultiPv;
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

            if (scoreType == null || scoreValue == null || depth < 0
                    || line.contains(" lowerbound") || line.contains(" upperbound")) {
                return;
            }
            EvalScore score = toEvalScore(sideToMove, scoreType, scoreValue);
            List<MoveDto> pv = toPvMoves(pvMoves, sideToMove);
            if (pv.isEmpty()) {
                return;
            }

            snapshots.computeIfAbsent(depth, ignored -> new TreeMap<>())
                    .put(multipv, new SearchCandidate(depth, score, pv));
        }

        void acceptBestMove(String line) {
            bestMoveReceived = true;
            String[] tokens = line.split("\\s+");
            if (tokens.length >= 2) {
                bestMove = toMoveDto(tokens[1], sideToMove);
            }
        }

        boolean hasBestMove() {
            return bestMoveReceived;
        }

        int maxDepth() {
            return maxDepth;
        }

        SearchResult toResult() {
            Map.Entry<Integer, Map<Integer, SearchCandidate>> snapshot = null;
            for (Map.Entry<Integer, Map<Integer, SearchCandidate>> entry : snapshots.entrySet()) {
                if (entry.getValue().containsKey(1) && entry.getValue().size() >= expectedMultiPv) {
                    snapshot = entry;
                }
            }
            if (snapshot == null) {
                for (Map.Entry<Integer, Map<Integer, SearchCandidate>> entry : snapshots.entrySet()) {
                    if (entry.getValue().containsKey(1)) snapshot = entry;
                }
            }
            Map<Integer, SearchCandidate> selected = snapshot == null ? Map.of() : snapshot.getValue();
            List<CandidateMove> candidates = new ArrayList<>();
            for (SearchCandidate candidate : selected.values()) {
                if (candidate.pv().isEmpty()) {
                    continue;
                }
                MoveDto move = candidate.pv().get(0);
                candidates.add(new CandidateMove(move, candidate.score(), candidate.pv()));
            }
            return new SearchResult(
                    bestMove,
                    selected.containsKey(1) ? selected.get(1).pv() : List.of(),
                    selected.containsKey(1) ? selected.get(1).score() : null,
                    snapshot == null ? 0 : snapshot.getKey(),
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
        private final BlockingQueue<String> output = new ArrayBlockingQueue<>(2048);
        private volatile boolean outputOverflow;
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
                        if (!output.offer(line)) {
                            outputOverflow = true;
                            break;
                        }
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

        UciIdentity waitForIdentity(long timeoutMs) {
            Instant deadline = Instant.now().plusMillis(timeoutMs);
            String name = null;
            Map<String, String> options = new java.util.HashMap<>();
            while (Instant.now().isBefore(deadline)) {
                String line = pollLine(100);
                if (line == null) {
                    continue;
                }
                if (line.startsWith("id name ")) {
                    name = line.substring("id name ".length()).trim();
                } else if (line.startsWith("option name ")) {
                    int type = line.indexOf(" type ");
                    if (type > 12) {
                        options.put(line.substring(12, type), line.substring(type + 6));
                    }
                } else if (line.trim().equals("uciok")) {
                    if (name == null) {
                        throw new IllegalStateException("UCI engine did not report id name");
                    }
                    return new UciIdentity(name, Map.copyOf(options));
                }
            }
            throw new IllegalStateException("Timeout waiting for UCI identity");
        }

        void drain() {
            output.clear();
        }

        String pollLine(long timeoutMs) {
            if (outputOverflow) {
                throw new IllegalStateException("UCI output queue overflow");
            }
            try {
                return output.poll(timeoutMs, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new CancellationException("UCI search interrupted");
            }
        }

        void shutdown() {
            if (process != null) {
                process.destroy();
                try {
                    if (!process.waitFor(200, TimeUnit.MILLISECONDS)) {
                        process.destroyForcibly();
                    }
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    process.destroyForcibly();
                }
            }
        }
    }
}
