package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.multiplayer.RoomStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RoomRepository extends JpaRepository<RoomEntity, UUID> {
    Optional<RoomEntity> findByRoomCodeIgnoreCase(String roomCode);
    List<RoomEntity> findByIsPublicTrueAndStatus(RoomStatus status);
    List<RoomEntity> findByIsPublicTrueAndStatusIn(List<RoomStatus> status);
    List<RoomEntity> findByHostUserIdAndStatus(Long hostUserId, RoomStatus status);
    List<RoomEntity> findByStatus(RoomStatus status);
    Optional<RoomEntity> findByGameId(java.util.UUID gameId);

    @Query("select r from RoomEntity r left join fetch r.hostUser where r.isPublic = true and r.status in :status")
    List<RoomEntity> findPublicRoomsWithHost(@Param("status") List<RoomStatus> status);
}
