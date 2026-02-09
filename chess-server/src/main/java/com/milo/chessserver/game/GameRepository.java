package com.milo.chessserver.game;

import com.milo.chessserver.user.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface GameRepository extends JpaRepository<GameEntity, UUID> {

    List<GameEntity> findByWhitePlayerOrBlackPlayer(UserEntity white, UserEntity black);

    List<GameEntity> findByResult(com.milo.chessdomain.GameResult result);

    Page<GameEntity> findByWhitePlayerOrBlackPlayer(UserEntity white, UserEntity black, Pageable pageable);
}
