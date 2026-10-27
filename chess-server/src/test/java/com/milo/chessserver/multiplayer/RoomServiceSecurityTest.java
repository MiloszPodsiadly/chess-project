package com.milo.chessserver.multiplayer;

import com.milo.chessserver.user.UserEntity;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.*;

class RoomServiceSecurityTest {
    @Test
    void roomHistoryIsNotReturnedToAUserWithoutActiveMembership() {
        RoomRepository rooms = mock(RoomRepository.class);
        RoomParticipantRepository participants = mock(RoomParticipantRepository.class);
        RoomMessageRepository messages = mock(RoomMessageRepository.class);
        RoomEntity room = new RoomEntity();
        room.setRoomCode("SECRET");
        UserEntity outsider = new UserEntity();
        ReflectionTestUtils.setField(outsider, "id", 41L);
        when(rooms.findByRoomCodeIgnoreCase("SECRET")).thenReturn(Optional.of(room));
        when(participants.findByRoomAndUserId(room, 41L)).thenReturn(Optional.empty());

        RoomService service = new RoomService(rooms, participants, mock(RoomInviteRepository.class),
                messages, mock(org.springframework.security.crypto.password.PasswordEncoder.class),
                mock(com.milo.chessserver.user.UserRepository.class));

        assertNull(service.roomHistory(outsider, "SECRET"));
        assertNull(service.roomParticipants(outsider, "SECRET"));
        verifyNoInteractions(messages);
        verify(participants, never()).findByRoomAndStatus(room, RoomParticipantStatus.ACTIVE);
    }

    @Test
    void guestDisplayNameCannotBeUsedAsTheIdentityToKickAnotherMember() {
        RoomRepository rooms = mock(RoomRepository.class);
        RoomParticipantRepository participants = mock(RoomParticipantRepository.class);
        RoomEntity room = new RoomEntity();
        room.setRoomCode("ROOM01");
        UserEntity host = new UserEntity();
        ReflectionTestUtils.setField(host, "id", 10L);
        UserEntity target = new UserEntity();
        ReflectionTestUtils.setField(target, "id", 20L);
        target.setDisplayName("Alice");
        room.setHostUser(host);
        when(rooms.findByRoomCodeIgnoreCase("ROOM01")).thenReturn(Optional.of(room));
        when(rooms.findLockedByRoomCodeIgnoreCase("ROOM01")).thenReturn(Optional.of(room));
        when(participants.findByRoomAndUserId(room, 20L)).thenReturn(Optional.empty());

        RoomService service = new RoomService(rooms, participants, mock(RoomInviteRepository.class),
                mock(RoomMessageRepository.class), mock(org.springframework.security.crypto.password.PasswordEncoder.class),
                mock(com.milo.chessserver.user.UserRepository.class));

        assertNull(service.kickPlayer(host, "ROOM01", 20L).user());
        verify(participants).findByRoomAndUserId(room, 20L);
        verify(participants, never()).findByRoomAndUserUsernameIgnoreCase(any(), anyString());
    }
}
