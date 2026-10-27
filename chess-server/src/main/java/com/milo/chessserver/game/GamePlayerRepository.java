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

    java.util.Optional<GamePlayerEntity> findByPreviousReconnectTokenHash(String previousReconnectTokenHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select player from GamePlayerEntity player where player.reconnectToken = :token "
            + "or player.previousReconnectTokenHash = :previousHash")
    java.util.Optional<GamePlayerEntity> findForReconnectUpdate(@Param("token") String token,
                                                                 @Param("previousHash") String previousHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select player from GamePlayerEntity player where player.game.id = :gameId and player.user.id = :userId")
    GamePlayerEntity findByGameIdAndUserIdForUpdate(@Param("gameId") UUID gameId, @Param("userId") Long userId);

    GamePlayerEntity findByGameIdAndUserId(UUID gameId, Long userId);
}
