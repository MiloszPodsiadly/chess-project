package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.multiplayer.RoomStatus;
import com.milo.chessdomain.multiplayer.RoomClosureReason;
import com.milo.chessdomain.multiplayer.RoomLifecycleEventType;
import com.milo.chessdomain.multiplayer.CreateRoomRequest;
import com.milo.chessdomain.multiplayer.JoinRoomRequest;
import com.milo.chessdomain.multiplayer.SpectateRoomRequest;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.time.Instant;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DataJpaTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:chess-room-joins;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({RoomService.class, RoomJoinConcurrencyTest.TestBeans.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class RoomJoinConcurrencyTest {
    @Autowired private RoomService roomService;
    @Autowired private RoomRepository roomRepository;
    @Autowired private RoomParticipantRepository participantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    @Test
    void concurrentJoinersCannotOverfillOrDoubleJoinOneRoom() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Long hostId = saveUser("host-" + suffix).getId();
        Long firstGuestId = saveUser("guest-a-" + suffix).getId();
        Long secondGuestId = saveUser("guest-b-" + suffix).getId();
        String roomCode = "ROOM" + suffix.toUpperCase();
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> roomService.createRoom(
                userRepository.findById(hostId).orElseThrow(),
                new CreateRoomRequest(TimeControlType.RAPID, "Concurrent room", null, true), roomCode));

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<RoomService.JoinRoomResult> first = executor.submit(() -> joinTogether(firstGuestId, roomCode, ready, start));
            Future<RoomService.JoinRoomResult> second = executor.submit(() -> joinTogether(secondGuestId, roomCode, ready, start));
            assertTrue(ready.await(2, TimeUnit.SECONDS));
            start.countDown();
            List<RoomService.JoinRoomResult> outcomes = List.of(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS));

            assertEquals(1, outcomes.stream().filter(result -> result.room() != null).count());
            assertEquals(1, outcomes.stream().filter(result -> "room_full".equals(result.error())).count());
            var room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElseThrow();
            assertEquals(1L, participantRepository.countByRoomAndStatusAndRole(
                    room, RoomParticipantStatus.ACTIVE, RoomParticipantRole.PLAYER));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void ownerDisconnectClosesOpenRoomAndReleasesItsParticipants() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Long hostId = saveUser("host-close-" + suffix).getId();
        Long guestId = saveUser("guest-close-" + suffix).getId();
        String roomCode = "CL" + suffix.toUpperCase();
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        List<RoomService.RoomLifecycleChange> changes = transaction.execute(status -> {
            UserEntity host = userRepository.findById(hostId).orElseThrow();
            UserEntity guest = userRepository.findById(guestId).orElseThrow();
            roomService.createRoom(host, new CreateRoomRequest(TimeControlType.RAPID, "Room", null, true), roomCode);
            roomService.joinRoom(guest, new JoinRoomRequest(roomCode, null, null));
            return roomService.handleDisconnect(host);
        });

        var room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElseThrow();
        assertEquals(RoomStatus.CLOSED, room.getStatus());
        assertEquals(RoomClosureReason.HOST_DISCONNECTED, room.getCloseReason());
        assertEquals(0L, participantRepository.countByRoomAndStatus(room, RoomParticipantStatus.ACTIVE));
        assertEquals(2, changes.get(0).recipientUserIds().size());
        assertTrue(changes.get(0).recipientUserIds().containsAll(List.of(hostId, guestId)));
        assertEquals(RoomLifecycleEventType.ROOM_CLOSED, changes.get(0).type());
    }

    @Test
    void expiredRoomClosesAndFreesParticipantsEvenWhenOwnerWasActive() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        Long hostId = saveUser("host-expire-" + suffix).getId();
        String roomCode = "EX" + suffix.toUpperCase();
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> roomService.createRoom(
                userRepository.findById(hostId).orElseThrow(),
                new CreateRoomRequest(TimeControlType.RAPID, "Room", null, true), roomCode));
        transaction.executeWithoutResult(status -> {
            var room = roomRepository.findLockedByRoomCodeIgnoreCase(roomCode).orElseThrow();
            room.setCreatedAt(Instant.now().minus(Duration.ofHours(1)));
            roomRepository.save(room);
        });

        List<RoomService.RoomLifecycleChange> changes = transaction.execute(
                status -> roomService.cleanupOldRooms(Duration.ofMinutes(10)));

        var room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElseThrow();
        assertEquals(RoomStatus.CLOSED, room.getStatus());
        assertEquals(RoomClosureReason.ROOM_EXPIRED, room.getCloseReason());
        assertEquals(0L, participantRepository.countByRoomAndStatus(room, RoomParticipantStatus.ACTIVE));
        assertEquals(RoomLifecycleEventType.ROOM_CLOSED, changes.get(0).type());
        assertEquals(List.of(hostId), changes.get(0).recipientUserIds());
    }

    @Test
    void deletingRoomCapturesPlayersAndSpectatorsBeforeRevokingMembership() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        UserEntity host = saveUser("host-delete-" + suffix);
        UserEntity guest = saveUser("guest-delete-" + suffix);
        UserEntity spectator = saveUser("watch-delete-" + suffix);
        String roomCode = "DL" + suffix.toUpperCase();
        roomService.createRoom(host, new CreateRoomRequest(TimeControlType.RAPID, "Room", null, true), roomCode);
        roomService.joinRoom(guest, new JoinRoomRequest(roomCode, null, null));
        roomService.spectateRoom(spectator, new SpectateRoomRequest(roomCode));

        RoomService.RoomLifecycleChange change = roomService.deleteRoom(host, roomCode);

        assertEquals(RoomLifecycleEventType.ROOM_CLOSED, change.type());
        assertEquals(RoomClosureReason.HOST_DELETED, change.closeReason());
        assertEquals(3, change.recipientUserIds().size());
        assertTrue(change.recipientUserIds().containsAll(List.of(host.getId(), guest.getId(), spectator.getId())));
        var room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElseThrow();
        assertEquals(RoomStatus.CLOSED, room.getStatus());
        assertEquals(3L, participantRepository.countByRoomAndStatus(room, RoomParticipantStatus.LEFT));
        assertEquals(RoomLifecycleEventType.ROOM_CLOSED,
                roomService.roomParticipants(host, roomCode).memberEvent());
        assertEquals(RoomStatus.CLOSED, roomService.roomParticipants(host, roomCode).roomStatus());
        assertNull(roomService.deleteRoom(host, roomCode));
    }

    @Test
    void kickIsDistinctFromVoluntaryLeaveAndFormerMemberCanReadItsLifecycleState() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        UserEntity host = saveUser("host-kick-" + suffix);
        UserEntity kicked = saveUser("kicked-" + suffix);
        UserEntity leaver = saveUser("leaver-" + suffix);
        String roomCode = "KI" + suffix.toUpperCase();
        roomService.createRoom(host, new CreateRoomRequest(TimeControlType.RAPID, "Room", null, true), roomCode);
        roomService.joinRoom(kicked, new JoinRoomRequest(roomCode, null, null));
        var kickedResult = roomService.kickPlayer(host, roomCode, kicked.getId());
        assertEquals(RoomLifecycleEventType.PARTICIPANT_KICKED, kickedResult.lifecycleChange().type());
        var room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElseThrow();
        assertEquals(RoomParticipantStatus.KICKED,
                participantRepository.findByRoomAndUserId(room, kicked.getId()).orElseThrow().getStatus());
        assertEquals(RoomLifecycleEventType.PARTICIPANT_KICKED,
                roomService.roomParticipants(kicked, roomCode).memberEvent());

        roomService.joinRoom(leaver, new JoinRoomRequest(roomCode, null, null));
        RoomService.RoomLifecycleChange left = roomService.leaveRoom(leaver, roomCode);
        assertEquals(RoomLifecycleEventType.PARTICIPANT_LEFT, left.type());
        assertEquals(RoomStatus.OPEN, left.roomStatus());
        assertEquals(List.of(host.getId()), left.recipientUserIds());
        assertEquals(RoomLifecycleEventType.PARTICIPANT_LEFT,
                participantRepository.findByRoomAndUserId(
                        roomRepository.findByRoomCodeIgnoreCase(roomCode).orElseThrow(), leaver.getId())
                        .orElseThrow().getLastLifecycleEvent());
    }

    @Test
    void disconnectedPrivateRoomMemberCanRecoverItsIdentityAndClosedRoomState() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        UserEntity host = saveUser("host-recover-" + suffix);
        UserEntity guest = saveUser("guest-recover-" + suffix);
        UserEntity outsider = saveUser("outsider-recover-" + suffix);
        String roomCode = "RC" + suffix.toUpperCase();
        var created = roomService.createRoom(host,
                new CreateRoomRequest(TimeControlType.RAPID, "Private", "secret", false), roomCode);
        var joined = roomService.joinRoom(guest, new JoinRoomRequest(roomCode, "secret", null));
        assertNotNull(created.recoveryToken());
        assertNotNull(joined.recoveryToken());

        roomService.handleDisconnect(guest);
        roomService.deleteRoom(host, roomCode);

        var recovered = roomService.recoverRoomSession(joined.recoveryToken());
        assertEquals(guest.getId(), recovered.user().getId());
        assertNotNull(recovered.recoveryToken());
        assertNotEquals(joined.recoveryToken(), recovered.recoveryToken());
        var terminalState = roomService.roomParticipants(recovered.user(), roomCode);
        assertEquals(RoomStatus.CLOSED, terminalState.roomStatus());
        assertEquals(RoomClosureReason.HOST_DELETED, terminalState.closeReason());
        assertEquals(RoomLifecycleEventType.ROOM_CLOSED, terminalState.memberEvent());
        assertTrue(terminalState.participants().isEmpty());

        assertNull(roomService.recoverRoomSession(joined.recoveryToken()).user());
        assertNull(roomService.roomParticipants(outsider, roomCode));
    }

    private UserEntity saveUser(String username) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction.execute(status -> {
            UserEntity user = new UserEntity();
            user.setUsername(username);
            user.setDisplayName(username);
            user.setEmail(username + "@test.local");
            user.setPasswordHash("unused");
            return userRepository.save(user);
        });
    }

    private RoomService.JoinRoomResult joinTogether(Long userId, String roomCode,
                                                     CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        assertTrue(start.await(2, TimeUnit.SECONDS));
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction.execute(status -> roomService.joinRoom(
                userRepository.findById(userId).orElseThrow(), new JoinRoomRequest(roomCode, null, null)));
    }

    @TestConfiguration
    static class TestBeans {
        @Bean
        PasswordEncoder passwordEncoder() {
            return new BCryptPasswordEncoder();
        }
    }
}
