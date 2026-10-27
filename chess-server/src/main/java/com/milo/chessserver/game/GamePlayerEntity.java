package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.PlayerType;
import com.milo.chessserver.user.UserEntity;
import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "game_players")
public class GamePlayerEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "game_id", nullable = false)
    private GameEntity game;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private UserEntity user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Color color;

    @Enumerated(EnumType.STRING)
    @Column(name = "player_type", nullable = false)
    private PlayerType playerType;

    @Column(name = "rating_at_start", nullable = false)
    private int ratingAtStart;

    @Column(name = "reconnect_token", nullable = false, unique = true, length = 64)
    private String reconnectToken;

    @Column(name = "previous_reconnect_token_hash", unique = true, length = 64)
    private String previousReconnectTokenHash;

    @Column(name = "previous_reconnect_token_expires_at")
    private Instant previousReconnectTokenExpiresAt;

    @Column(name = "reconnect_ack_id", length = 36)
    private String reconnectAckId;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt = Instant.now();

    @Column(name = "joined_at", nullable = false)
    private Instant joinedAt = Instant.now();

    public Long getId() {
        return id;
    }

    public GameEntity getGame() {
        return game;
    }

    public void setGame(GameEntity game) {
        this.game = game;
    }

    public UserEntity getUser() {
        return user;
    }

    public void setUser(UserEntity user) {
        this.user = user;
    }

    public Color getColor() {
        return color;
    }

    public void setColor(Color color) {
        this.color = color;
    }

    public PlayerType getPlayerType() {
        return playerType;
    }

    public void setPlayerType(PlayerType playerType) {
        this.playerType = playerType;
    }

    public int getRatingAtStart() {
        return ratingAtStart;
    }

    public void setRatingAtStart(int ratingAtStart) {
        this.ratingAtStart = ratingAtStart;
    }

    public String getReconnectToken() {
        return reconnectToken;
    }

    public void setReconnectToken(String reconnectToken) {
        this.reconnectToken = reconnectToken;
    }

    public String getPreviousReconnectTokenHash() {
        return previousReconnectTokenHash;
    }

    public void setPreviousReconnectTokenHash(String previousReconnectTokenHash) {
        this.previousReconnectTokenHash = previousReconnectTokenHash;
    }

    public Instant getPreviousReconnectTokenExpiresAt() {
        return previousReconnectTokenExpiresAt;
    }

    public void setPreviousReconnectTokenExpiresAt(Instant previousReconnectTokenExpiresAt) {
        this.previousReconnectTokenExpiresAt = previousReconnectTokenExpiresAt;
    }

    public String getReconnectAckId() {
        return reconnectAckId;
    }

    public void setReconnectAckId(String reconnectAckId) {
        this.reconnectAckId = reconnectAckId;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public void setLastSeenAt(Instant lastSeenAt) {
        this.lastSeenAt = lastSeenAt;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }

    public void setJoinedAt(Instant joinedAt) {
        this.joinedAt = joinedAt;
    }
}
