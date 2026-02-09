package com.milo.chessserver.game;

import com.milo.chessdomain.*;
import com.milo.chessserver.user.UserEntity;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "games")
public class GameEntity {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "white_player_id")
    private UserEntity whitePlayer;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "black_player_id")
    private UserEntity blackPlayer;

    @Enumerated(EnumType.STRING)
    @Column(name = "game_type", nullable = false)
    private GameType gameType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private GameVariant variant;

    @Enumerated(EnumType.STRING)
    @Column(name = "side_to_move", nullable = false)
    private Color sideToMove;

    @Column(name = "current_fen", nullable = false, length = 128)
    private String currentFen;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private GameResult result = GameResult.ONGOING;

    @Enumerated(EnumType.STRING)
    @Column(name = "end_reason", nullable = false)
    private GameEndReason endReason = GameEndReason.NONE;

    @Enumerated(EnumType.STRING)
    @Column(name = "time_control_type", nullable = false)
    private TimeControlType timeControlType = TimeControlType.RAPID;

    @Column(name = "engine_elo", nullable = false)
    private int engineElo;

    @Column(name = "white_time_left_ms", nullable = false)
    private long whiteTimeLeftMs;

    @Column(name = "black_time_left_ms", nullable = false)
    private long blackTimeLeftMs;

    @Column(name = "last_move_at")
    private Instant lastMoveAt;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt = Instant.now();

    @Column(name = "finished_at")
    private Instant finishedAt;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UserEntity getWhitePlayer() {
        return whitePlayer;
    }

    public void setWhitePlayer(UserEntity whitePlayer) {
        this.whitePlayer = whitePlayer;
    }

    public UserEntity getBlackPlayer() {
        return blackPlayer;
    }

    public void setBlackPlayer(UserEntity blackPlayer) {
        this.blackPlayer = blackPlayer;
    }

    public GameType getGameType() {
        return gameType;
    }

    public void setGameType(GameType gameType) {
        this.gameType = gameType;
    }

    public GameVariant getVariant() {
        return variant;
    }

    public void setVariant(GameVariant variant) {
        this.variant = variant;
    }

    public Color getSideToMove() {
        return sideToMove;
    }

    public void setSideToMove(Color sideToMove) {
        this.sideToMove = sideToMove;
    }

    public String getCurrentFen() {
        return currentFen;
    }

    public void setCurrentFen(String currentFen) {
        this.currentFen = currentFen;
    }

    public GameResult getResult() {
        return result;
    }

    public void setResult(GameResult result) {
        this.result = result;
    }

    public GameEndReason getEndReason() {
        return endReason;
    }

    public void setEndReason(GameEndReason endReason) {
        this.endReason = endReason;
    }

    public TimeControlType getTimeControlType() {
        return timeControlType;
    }

    public void setTimeControlType(TimeControlType timeControlType) {
        this.timeControlType = timeControlType;
    }

    public int getEngineElo() {
        return engineElo;
    }

    public void setEngineElo(int engineElo) {
        this.engineElo = engineElo;
    }

    public long getWhiteTimeLeftMs() {
        return whiteTimeLeftMs;
    }

    public void setWhiteTimeLeftMs(long whiteTimeLeftMs) {
        this.whiteTimeLeftMs = whiteTimeLeftMs;
    }

    public long getBlackTimeLeftMs() {
        return blackTimeLeftMs;
    }

    public void setBlackTimeLeftMs(long blackTimeLeftMs) {
        this.blackTimeLeftMs = blackTimeLeftMs;
    }

    public Instant getLastMoveAt() {
        return lastMoveAt;
    }

    public void setLastMoveAt(Instant lastMoveAt) {
        this.lastMoveAt = lastMoveAt;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }
}
