package com.milo.chessserver;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.transaction.PlatformTransactionManager;

import com.milo.chessserver.game.GameMoveRepository;
import com.milo.chessserver.game.GamePlayerRepository;
import com.milo.chessserver.game.GameRepository;
import com.milo.chessserver.multiplayer.RoomInviteRepository;
import com.milo.chessserver.multiplayer.RoomMessageRepository;
import com.milo.chessserver.multiplayer.RoomParticipantRepository;
import com.milo.chessserver.multiplayer.RoomRepository;
import com.milo.chessserver.user.UserRepository;

@SpringBootTest(properties = {
        "spring.autoconfigure.exclude=" +
                "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration," +
                "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration," +
                "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration"
})
class ChessServerApplicationTests {

    @MockBean
    private PlatformTransactionManager transactionManager;

    @MockBean
    private UserRepository userRepository;

    @MockBean
    private GameRepository gameRepository;

    @MockBean
    private GameMoveRepository gameMoveRepository;

    @MockBean
    private GamePlayerRepository gamePlayerRepository;

    @MockBean
    private RoomRepository roomRepository;

    @MockBean
    private RoomParticipantRepository roomParticipantRepository;

    @MockBean
    private RoomInviteRepository roomInviteRepository;

    @MockBean
    private RoomMessageRepository roomMessageRepository;

    @Test
    void contextLoads() {
    }

}
