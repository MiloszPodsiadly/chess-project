package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "moves")
public class GameMoveEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "game_id", nullable = false)
    private GameEntity game;

    @Column(name = "move_number", nullable = false)
    private int moveNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "player_color", nullable = false)
    private Color playerColor;

    @Column(name = "from_square", nullable = false, length = 2)
    private String fromSquare;

    @Column(name = "to_square", nullable = false, length = 2)
    private String toSquare;

    @Column(length = 2)
    private String promotion;

    @Column(name = "fen_after_move", nullable = false, length = 128)
    private String fenAfterMove;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() {
        return id;
    }

    public GameEntity getGame() {
        return game;
    }

    public void setGame(GameEntity game) {
        this.game = game;
    }

    public int getMoveNumber() {
        return moveNumber;
    }

    public void setMoveNumber(int moveNumber) {
        this.moveNumber = moveNumber;
    }

    public Color getPlayerColor() {
        return playerColor;
    }

    public void setPlayerColor(Color playerColor) {
        this.playerColor = playerColor;
    }

    public String getFromSquare() {
        return fromSquare;
    }

    public void setFromSquare(String fromSquare) {
        this.fromSquare = fromSquare;
    }

    public String getToSquare() {
        return toSquare;
    }

    public void setToSquare(String toSquare) {
        this.toSquare = toSquare;
    }

    public String getPromotion() {
        return promotion;
    }

    public void setPromotion(String promotion) {
        this.promotion = promotion;
    }

    public String getFenAfterMove() {
        return fenAfterMove;
    }

    public void setFenAfterMove(String fenAfterMove) {
        this.fenAfterMove = fenAfterMove;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
