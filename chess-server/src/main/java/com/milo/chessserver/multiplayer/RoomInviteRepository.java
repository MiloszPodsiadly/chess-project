package com.milo.chessserver.multiplayer;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RoomInviteRepository extends JpaRepository<RoomInviteEntity, Long> {
    Optional<RoomInviteEntity> findByToken(String token);
}
