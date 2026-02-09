package com.milo.chessserver.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface GamePlayerRepository extends JpaRepository<GamePlayerEntity, Long> {

    List<GamePlayerEntity> findByGameId(UUID gameId);

    GamePlayerEntity findByReconnectToken(String reconnectToken);

    GamePlayerEntity findByGameIdAndUserId(UUID gameId, Long userId);
}
