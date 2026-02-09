package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class MatchmakingServiceTest {

    @Test
    void createsAndJoinsRoom() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        String code = service.createRoom(1L, "host", TimeControlType.RAPID, "Room", null, true);
        assertNotNull(code);

        MatchmakingService.JoinResult join = service.joinRoom(code, null);
        MatchmakingService.Room room = join.room();
        assertNotNull(room);
        assertEquals(1L, room.hostUserId());
    }

    @Test
    void cleanupRemovesOldRooms() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        String code = service.createRoom(1L, "host", TimeControlType.RAPID, "Room", null, true);
        assertNotNull(code);

        try {
            Thread.sleep(5);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
        service.cleanup(Duration.ZERO, Duration.ofMinutes(5));
        MatchmakingService.JoinResult join = service.joinRoom(code, null);
        assertNull(join.room());
    }

    @Test
    void privateRoomRequiresPassword() {
        MatchmakingService service = new MatchmakingService(new BCryptPasswordEncoder());
        String code = service.createRoom(1L, "host", TimeControlType.RAPID, "Secret", "pass123", false);
        assertNotNull(code);

        MatchmakingService.JoinResult wrong = service.joinRoom(code, "bad");
        assertNull(wrong.room());
        assertEquals("bad_password", wrong.error());

        MatchmakingService.JoinResult ok = service.joinRoom(code, "pass123");
        assertNotNull(ok.room());
    }
}
