package com.milo.chessserver.multiplayer;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RoomMessageRepository extends JpaRepository<RoomMessageEntity, Long> {
    List<RoomMessageEntity> findTop50ByRoomOrderByCreatedAtDesc(RoomEntity room);
}
