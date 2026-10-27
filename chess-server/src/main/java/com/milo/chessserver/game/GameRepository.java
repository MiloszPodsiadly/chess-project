package com.milo.chessserver.game;

import com.milo.chessserver.user.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import com.milo.chessdomain.GameResult;

import java.util.List;
import java.util.UUID;
import java.util.Optional;

public interface GameRepository extends JpaRepository<GameEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from GameEntity g where g.id = :id")
    Optional<GameEntity> findLockedById(@Param("id") UUID id);

    List<GameEntity> findTop20ByGameTypeAndEngineTurnStateAndResultOrderByEngineLeaseUntilAsc(
            com.milo.chessdomain.GameType gameType,
            com.milo.chessdomain.GameTurnState engineTurnState,
            com.milo.chessdomain.GameResult result);

    List<GameEntity> findByWhitePlayerOrBlackPlayer(UserEntity white, UserEntity black);

    List<GameEntity> findByResult(com.milo.chessdomain.GameResult result);

    @Query("select g.id from GameEntity g where g.result = :result")
    List<UUID> findIdsByResult(@Param("result") GameResult result);

    Page<GameEntity> findByWhitePlayerOrBlackPlayer(UserEntity white, UserEntity black, Pageable pageable);
}
