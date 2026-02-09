package com.milo.chessserver.game;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface GameMoveRepository extends JpaRepository<GameMoveEntity, Long> {

    List<GameMoveEntity> findByGameIdOrderByMoveNumberAsc(UUID gameId);

    long countByGameId(UUID gameId);

    @org.springframework.data.jpa.repository.Query("""
            select m.fenAfterMove
            from GameMoveEntity m
            where m.game.id = :gameId
            order by m.moveNumber asc
            """)
    List<String> findFenAfterMoveByGameIdOrderByMoveNumberAsc(java.util.UUID gameId);
}
