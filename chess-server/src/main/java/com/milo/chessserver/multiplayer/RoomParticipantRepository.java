package com.milo.chessserver.multiplayer;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RoomParticipantRepository extends JpaRepository<RoomParticipantEntity, Long> {
    long countByRoomAndStatus(RoomEntity room, RoomParticipantStatus status);
    long countByRoomAndStatusAndRole(RoomEntity room, RoomParticipantStatus status, RoomParticipantRole role);
    Optional<RoomParticipantEntity> findByRoomAndUserId(RoomEntity room, Long userId);
    List<RoomParticipantEntity> findByRoomAndStatus(RoomEntity room, RoomParticipantStatus status);
    List<RoomParticipantEntity> findByRoom(RoomEntity room);
    Optional<RoomParticipantEntity> findByRecoveryTokenHash(String recoveryTokenHash);
    Optional<RoomParticipantEntity> findFirstByRoomAndStatusAndRole(RoomEntity room, RoomParticipantStatus status, RoomParticipantRole role);
    List<RoomParticipantEntity> findByUserIdAndStatus(Long userId, RoomParticipantStatus status);
}
