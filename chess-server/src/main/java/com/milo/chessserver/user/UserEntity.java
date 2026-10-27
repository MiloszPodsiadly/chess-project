package com.milo.chessserver.user;

import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "users")
public class UserEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 32)
    private String username;

    @Column(name = "display_name", length = 32)
    private String displayName;

    @Column(name = "is_guest", nullable = false, columnDefinition = "boolean default false")
    private boolean guest;

    @Column(nullable = false, unique = true, length = 128)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "rating_rapid", nullable = false)
    private int ratingRapid = 1200;
    @Column(name = "rating_blitz", nullable = false)
    private int ratingBlitz = 1200;
    @Column(name = "rating_vs_engine", nullable = false)
    private int ratingVsEngine = 1200;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getDisplayName() {
        return displayName == null || displayName.isBlank() ? username : displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public boolean isGuest() {
        return guest;
    }

    public void setGuest(boolean guest) {
        this.guest = guest;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public int getRatingRapid() {
        return ratingRapid;
    }

    public void setRatingRapid(int ratingRapid) {
        this.ratingRapid = ratingRapid;
    }

    public int getRatingBlitz() {
        return ratingBlitz;
    }

    public void setRatingBlitz(int ratingBlitz) {
        this.ratingBlitz = ratingBlitz;
    }

    public int getRatingVsEngine() {
        return ratingVsEngine;
    }

    public void setRatingVsEngine(int ratingVsEngine) {
        this.ratingVsEngine = ratingVsEngine;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
