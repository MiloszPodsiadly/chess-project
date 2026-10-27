package com.milo.chessserver.game;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.UUID;

public interface GamePlayerRepository extends JpaRepository<GamePlayerEntity, Long> {

    List<GamePlayerEntity> findByGameId(UUID gameId);

    java.util.Optional<GamePlayerEntity> findByReconnectToken(String reconnectToken);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select player from GamePlayerEntity player where player.reconnectToken = :token")
    java.util.Optional<GamePlayerEntity> findByReconnectTokenForUpdate(@Param("token") String token);

    GamePlayerEntity findByGameIdAndUserId(UUID gameId, Long userId);
}
