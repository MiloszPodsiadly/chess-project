package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.multiplayer.RoomLifecycleEventType;
import com.milo.chessserver.user.UserEntity;
import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "room_participants")
public class RoomParticipantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "room_id", nullable = false)
    private RoomEntity room;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private UserEntity user;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    private RoomParticipantRole role = RoomParticipantRole.PLAYER;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private RoomParticipantStatus status = RoomParticipantStatus.ACTIVE;

    @Enumerated(EnumType.STRING)
    @Column(name = "last_lifecycle_event")
    private RoomLifecycleEventType lastLifecycleEvent = RoomLifecycleEventType.ROOM_OPEN;

    @Column(name = "joined_at", nullable = false)
    private Instant joinedAt = Instant.now();

    @Column(name = "left_at")
    private Instant leftAt;

    @Column(name = "recovery_token_hash", unique = true, length = 64)
    private String recoveryTokenHash;

    public Long getId() {
        return id;
    }

    public RoomEntity getRoom() {
        return room;
    }

    public void setRoom(RoomEntity room) {
        this.room = room;
    }

    public UserEntity getUser() {
        return user;
    }

    public void setUser(UserEntity user) {
        this.user = user;
    }

    public RoomParticipantRole getRole() {
        return role;
    }

    public void setRole(RoomParticipantRole role) {
        this.role = role;
    }

    public RoomParticipantStatus getStatus() {
        return status;
    }

    public void setStatus(RoomParticipantStatus status) {
        this.status = status;
    }

    public RoomLifecycleEventType getLastLifecycleEvent() {
        return lastLifecycleEvent;
    }

    public void setLastLifecycleEvent(RoomLifecycleEventType lastLifecycleEvent) {
        this.lastLifecycleEvent = lastLifecycleEvent;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }

    public void setJoinedAt(Instant joinedAt) {
        this.joinedAt = joinedAt;
    }

    public Instant getLeftAt() {
        return leftAt;
    }

    public void setLeftAt(Instant leftAt) {
        this.leftAt = leftAt;
    }

    public String getRecoveryTokenHash() {
        return recoveryTokenHash;
    }

    public void setRecoveryTokenHash(String recoveryTokenHash) {
        this.recoveryTokenHash = recoveryTokenHash;
    }
}
