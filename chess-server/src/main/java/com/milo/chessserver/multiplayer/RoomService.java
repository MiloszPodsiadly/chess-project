package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.TimeControlType;
import com.milo.chessdomain.multiplayer.*;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class RoomService {

    private final RoomRepository roomRepository;
    private final RoomParticipantRepository participantRepository;
    private final RoomInviteRepository inviteRepository;
    private final RoomMessageRepository messageRepository;
    private final PasswordEncoder passwordEncoder;
    private final UserRepository userRepository;

    public RoomService(RoomRepository roomRepository,
                       RoomParticipantRepository participantRepository,
                       RoomInviteRepository inviteRepository,
                       RoomMessageRepository messageRepository,
                       PasswordEncoder passwordEncoder,
                       UserRepository userRepository) {
        this.roomRepository = roomRepository;
        this.participantRepository = participantRepository;
        this.inviteRepository = inviteRepository;
        this.messageRepository = messageRepository;
        this.passwordEncoder = passwordEncoder;
        this.userRepository = userRepository;
    }

    @Transactional
    public CreateRoomResult createRoom(UserEntity host, CreateRoomRequest request, String code) {
        if (host == null) {
            return new CreateRoomResult(null, "no_host");
        }
        host = lockUser(host);
        if (isActiveInOtherRoom(host, null)) {
            return new CreateRoomResult(null, "already_in_room");
        }
        List<RoomEntity> existing = roomRepository.findByHostUserIdAndStatus(host.getId(), RoomStatus.OPEN);
        if (!existing.isEmpty()) {
            return new CreateRoomResult(null, "room_already_open");
        }
        RoomEntity room = new RoomEntity();
        room.setId(UUID.randomUUID());
        room.setRoomCode(code);
        room.setHostUser(host);
        room.setStatus(RoomStatus.OPEN);
        TimeControlType tc = request == null || request.timeControlType() == null ? TimeControlType.RAPID : request.timeControlType();
        room.setTimeControlType(tc);
        room.setName(normalizeName(request == null ? null : request.name()));
        boolean isPublic = request == null || request.isPublic() == null || request.isPublic();
        room.setPublic(isPublic);
        String rawPassword = normalizePassword(request == null ? null : request.password());
        if (!isPublic && rawPassword != null) {
            room.setPasswordHash(passwordEncoder.encode(rawPassword));
        }
        room.setCreatedAt(Instant.now());
        roomRepository.save(room);

        RoomParticipantEntity hostEntry = new RoomParticipantEntity();
        hostEntry.setRoom(room);
        hostEntry.setUser(host);
        hostEntry.setRole(RoomParticipantRole.HOST);
        hostEntry.setStatus(RoomParticipantStatus.ACTIVE);
        participantRepository.save(hostEntry);

        return new CreateRoomResult(room, null);
    }

    @Transactional
    public JoinRoomResult joinRoom(UserEntity guest, JoinRoomRequest request) {
        if (guest == null || request == null || request.roomCode() == null) {
            return new JoinRoomResult(null, "room_not_found");
        }
        guest = lockUser(guest);
        RoomEntity room = roomRepository.findLockedByRoomCodeIgnoreCase(request.roomCode())
                .orElse(null);
        if (room == null || room.getStatus() != RoomStatus.OPEN) {
            return new JoinRoomResult(null, "room_not_found");
        }
        if (isActiveInOtherRoom(guest, room)) {
            return new JoinRoomResult(null, "already_in_room");
        }
        if (room.getHostUser() != null && room.getHostUser().getId().equals(guest.getId())) {
            return new JoinRoomResult(null, "host_cannot_join");
        }
        long players = participantRepository.countByRoomAndStatusAndRole(room, RoomParticipantStatus.ACTIVE, RoomParticipantRole.PLAYER);
        long hosts = participantRepository.countByRoomAndStatusAndRole(room, RoomParticipantStatus.ACTIVE, RoomParticipantRole.HOST);
        if (players + hosts >= 2) {
            return new JoinRoomResult(null, "room_full");
        }

        String inviteToken = normalizePassword(request.inviteToken());
        if (!room.isPublic() && !isInviteValid(room, inviteToken)) {
            String rawPassword = normalizePassword(request.password());
            if (rawPassword == null || room.getPasswordHash() == null || !passwordEncoder.matches(rawPassword, room.getPasswordHash())) {
                return new JoinRoomResult(null, "bad_password");
            }
        }
        RoomParticipantEntity participant = participantRepository.findByRoomAndUserId(room, guest.getId())
                .orElseGet(RoomParticipantEntity::new);
        participant.setRoom(room);
        participant.setUser(guest);
        participant.setRole(RoomParticipantRole.PLAYER);
        participant.setStatus(RoomParticipantStatus.ACTIVE);
        participant.setJoinedAt(Instant.now());
        participantRepository.save(participant);
        return new JoinRoomResult(room, null);
    }

    @Transactional
    public JoinRoomResult spectateRoom(UserEntity user, SpectateRoomRequest request) {
        if (user == null || request == null || request.roomCode() == null) {
            return new JoinRoomResult(null, "room_not_found");
        }
        user = lockUser(user);
        RoomEntity room = roomRepository.findLockedByRoomCodeIgnoreCase(request.roomCode())
                .orElse(null);
        if (room == null || !room.isPublic()) {
            return new JoinRoomResult(null, "room_not_found");
        }
        if (isActiveInOtherRoom(user, room)) {
            return new JoinRoomResult(null, "already_in_room");
        }
        if (room.getStatus() == RoomStatus.CLOSED) {
            return new JoinRoomResult(null, "room_closed");
        }
        RoomParticipantEntity participant = participantRepository.findByRoomAndUserId(room, user.getId())
                .orElseGet(RoomParticipantEntity::new);
        participant.setRoom(room);
        participant.setUser(user);
        participant.setRole(RoomParticipantRole.SPECTATOR);
        participant.setStatus(RoomParticipantStatus.ACTIVE);
        participant.setJoinedAt(Instant.now());
        participantRepository.save(participant);
        return new JoinRoomResult(room, null);
    }

    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public List<PublicRoomDto> listPublicRooms() {
        return roomRepository.findPublicRoomsWithHost(List.of(RoomStatus.OPEN, RoomStatus.IN_GAME))
                .stream()
                .map(room -> new PublicRoomDto(
                        room.getRoomCode(),
                        room.getName(),
                        room.getHostUser() != null ? room.getHostUser().getDisplayName() : null,
                        room.getHostUser() != null ? room.getHostUser().getId() : null,
                        room.getTimeControlType(),
                        room.getCreatedAt(),
                        room.getStatus(),
                        (int) participantRepository.countByRoomAndStatus(room, RoomParticipantStatus.ACTIVE)
                ))
                .collect(Collectors.toList());
    }

    @Transactional
    public RoomInviteDto createInvite(UserEntity user, CreateInviteRequest request) {
        if (user == null || request == null || request.roomCode() == null) {
            return null;
        }
        RoomEntity room = roomRepository.findByRoomCodeIgnoreCase(request.roomCode())
                .orElse(null);
        if (room == null || room.getHostUser() == null || !room.getHostUser().getId().equals(user.getId())) {
            return null;
        }
        RoomInviteEntity invite = new RoomInviteEntity();
        invite.setRoom(room);
        invite.setToken(UUID.randomUUID().toString().replace("-", ""));
        invite.setMaxUses(request.maxUses() == null ? 1 : Math.max(1, request.maxUses()));
        if (request.expiresInMinutes() != null && request.expiresInMinutes() > 0) {
            invite.setExpiresAt(Instant.now().plus(request.expiresInMinutes(), ChronoUnit.MINUTES));
        }
        inviteRepository.save(invite);
        return new RoomInviteDto(room.getRoomCode(), invite.getToken(), invite.getExpiresAt(), invite.getMaxUses(), invite.getUses());
    }

    @Transactional
    public RoomMessageDto addMessage(UserEntity user, SendRoomMessageRequest request) {
        if (user == null || request == null || request.roomCode() == null || request.message() == null) {
            return null;
        }
        RoomEntity room = roomRepository.findByRoomCodeIgnoreCase(request.roomCode())
                .orElse(null);
        if (room == null) {
            return null;
        }
        Optional<RoomParticipantEntity> participant = participantRepository.findByRoomAndUserId(room, user.getId());
        if (participant.isEmpty() || participant.get().getStatus() != RoomParticipantStatus.ACTIVE) {
            return null;
        }
        RoomMessageEntity message = new RoomMessageEntity();
        message.setRoom(room);
        message.setUser(user);
        message.setUsername(user.getDisplayName());
        message.setMessage(request.message().trim());
        messageRepository.save(message);
        return new RoomMessageDto(room.getRoomCode(), message.getUsername(), message.getMessage(), message.getCreatedAt());
    }

    public List<RoomMessageDto> roomHistory(UserEntity user, String roomCode) {
        if (user == null || roomCode == null || !isActiveRoomParticipant(user.getId(), roomCode)) {
            return null;
        }
        RoomEntity room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElse(null);
        if (room == null) {
            return List.of();
        }
        List<RoomMessageEntity> messages = messageRepository.findTop50ByRoomOrderByCreatedAtDesc(room);
        return messages.stream()
                .sorted((a, b) -> a.getCreatedAt().compareTo(b.getCreatedAt()))
                .map(m -> new RoomMessageDto(room.getRoomCode(), m.getUsername(), m.getMessage(), m.getCreatedAt()))
                .collect(Collectors.toList());
    }

    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public RoomParticipantsDto roomParticipants(UserEntity user, String roomCode) {
        if (user == null || roomCode == null || !isActiveRoomParticipant(user.getId(), roomCode)) {
            return null;
        }
        return roomParticipantsForBroadcast(roomCode);
    }

    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public RoomParticipantsDto roomParticipantsForBroadcast(String roomCode) {
        if (roomCode == null || roomCode.isBlank()) return null;
        RoomEntity room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElse(null);
        if (room == null) {
            return null;
        }
        List<RoomParticipantDto> participants = participantRepository.findByRoomAndStatus(room, RoomParticipantStatus.ACTIVE)
                .stream()
                .map(p -> {
                    String status = p.getStatus() != null ? p.getStatus().name() : null;
                    if (room.getStatus() == RoomStatus.OPEN && room.getGameId() == null
                            && p.getRole() == RoomParticipantRole.PLAYER && status != null) {
                        status = "PENDING";
                    }
                    return new RoomParticipantDto(
                            p.getUser() != null ? p.getUser().getId() : null,
                            p.getUser() != null ? p.getUser().getDisplayName() : null,
                            p.getRole() != null ? p.getRole().name() : null,
                            status
                    );
                })
                .collect(Collectors.toList());
        return new RoomParticipantsDto(room.getRoomCode(), participants);
    }

    @Transactional
    public void markRoomInGame(RoomEntity room, UUID gameId) {
        if (room == null) {
            return;
        }
        room.setStatus(RoomStatus.IN_GAME);
        room.setGameId(gameId);
        room.setUpdatedAt(Instant.now());
        roomRepository.save(room);
    }

    @Transactional
    public void closeRoomByGame(UUID gameId) {
        if (gameId == null) {
            return;
        }
        Optional<RoomEntity> room = roomRepository.findByGameId(gameId);
        if (room.isEmpty()) {
            return;
        }
        RoomEntity entity = room.get();
        entity.setStatus(RoomStatus.CLOSED);
        entity.setUpdatedAt(Instant.now());
        roomRepository.save(entity);
    }

    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public String findRoomCodeByGame(UUID gameId) {
        if (gameId == null) {
            return null;
        }
        return roomRepository.findByGameId(gameId)
                .map(RoomEntity::getRoomCode)
                .orElse(null);
    }

    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public boolean isActiveRoomParticipant(Long userId, String roomCode) {
        if (userId == null || roomCode == null || roomCode.isBlank()) return false;
        RoomEntity room = roomRepository.findByRoomCodeIgnoreCase(roomCode).orElse(null);
        if (room == null) return false;
        return participantRepository.findByRoomAndUserId(room, userId)
                .map(participant -> participant.getStatus() == RoomParticipantStatus.ACTIVE)
                .orElse(false);
    }

    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public boolean isActiveParticipantInGame(Long userId, UUID gameId) {
        if (userId == null || gameId == null) return false;
        RoomEntity room = roomRepository.findByGameId(gameId).orElse(null);
        if (room == null) return false;
        return participantRepository.findByRoomAndUserId(room, userId)
                .map(participant -> participant.getStatus() == RoomParticipantStatus.ACTIVE)
                .orElse(false);
    }

    @Transactional
    public void removeRoomsForHost(Long hostUserId) {
        if (hostUserId == null) {
            return;
        }
        List<RoomEntity> rooms = roomRepository.findByHostUserIdAndStatus(hostUserId, RoomStatus.OPEN);
        for (RoomEntity room : rooms) {
            room.setStatus(RoomStatus.CLOSED);
            room.setUpdatedAt(Instant.now());
            roomRepository.save(room);
        }
    }

    @Transactional
    public List<String> handleDisconnect(UserEntity user) {
        if (user == null) {
            return List.of();
        }
        user = lockUser(user);
        List<RoomParticipantEntity> participants = participantRepository.findByUserIdAndStatus(user.getId(), RoomParticipantStatus.ACTIVE);
        if (participants.isEmpty()) {
            return List.of();
        }
        List<String> updated = new java.util.ArrayList<>();
        Instant now = Instant.now();
        for (RoomParticipantEntity participant : participants) {
            RoomEntity room = participant.getRoom();
            if (room != null) {
                room = roomRepository.findLockedByRoomCodeIgnoreCase(room.getRoomCode()).orElse(room);
            }
            if (room == null || room.getStatus() != RoomStatus.OPEN) {
                continue;
            }
            if (participant.getRole() == RoomParticipantRole.HOST) {
                room.setStatus(RoomStatus.CLOSED);
                room.setUpdatedAt(now);
                roomRepository.save(room);
                List<RoomParticipantEntity> roomParticipants = participantRepository.findByRoomAndStatus(room, RoomParticipantStatus.ACTIVE);
                for (RoomParticipantEntity roomParticipant : roomParticipants) {
                    roomParticipant.setStatus(RoomParticipantStatus.LEFT);
                    roomParticipant.setLeftAt(now);
                    participantRepository.save(roomParticipant);
                }
                updated.add(room.getRoomCode());
                continue;
            }
            participant.setStatus(RoomParticipantStatus.LEFT);
            participant.setLeftAt(now);
            participantRepository.save(participant);
            updated.add(room.getRoomCode());
        }
        return updated;
    }

    @Transactional
    public void leaveRoom(UserEntity user, String roomCode) {
        if (user == null || roomCode == null || roomCode.isBlank()) {
            return;
        }
        user = lockUser(user);
        RoomEntity room = roomRepository.findLockedByRoomCodeIgnoreCase(roomCode).orElse(null);
        if (room == null) {
            return;
        }
        if (room.getStatus() == RoomStatus.IN_GAME) {
            return;
        }
        if (room.getHostUser() != null && room.getHostUser().getId().equals(user.getId())) {
            room.setStatus(RoomStatus.CLOSED);
            room.setUpdatedAt(Instant.now());
            roomRepository.save(room);
            List<RoomParticipantEntity> participants = participantRepository.findByRoomAndStatus(room, RoomParticipantStatus.ACTIVE);
            for (RoomParticipantEntity participant : participants) {
                participant.setStatus(RoomParticipantStatus.LEFT);
                participant.setLeftAt(Instant.now());
                participantRepository.save(participant);
            }
            return;
        }
        participantRepository.findByRoomAndUserId(room, user.getId()).ifPresent(participant -> {
            participant.setStatus(RoomParticipantStatus.LEFT);
            participant.setLeftAt(Instant.now());
            participantRepository.save(participant);
        });
        long active = participantRepository.countByRoomAndStatus(room, RoomParticipantStatus.ACTIVE);
        if (active == 0) {
            room.setStatus(RoomStatus.CLOSED);
            room.setUpdatedAt(Instant.now());
            roomRepository.save(room);
        }
    }

    @Transactional
    public boolean deleteRoom(UserEntity user, String roomCode) {
        if (user == null || roomCode == null || roomCode.isBlank()) {
            return false;
        }
        user = lockUser(user);
        RoomEntity room = roomRepository.findLockedByRoomCodeIgnoreCase(roomCode).orElse(null);
        if (room == null) {
            return false;
        }
        if (room.getHostUser() == null || !room.getHostUser().getId().equals(user.getId())) {
            return false;
        }
        if (room.getStatus() == RoomStatus.IN_GAME) {
            return false;
        }
        room.setStatus(RoomStatus.CLOSED);
        room.setUpdatedAt(Instant.now());
        roomRepository.save(room);
        List<RoomParticipantEntity> participants = participantRepository.findByRoomAndStatus(room, RoomParticipantStatus.ACTIVE);
        for (RoomParticipantEntity participant : participants) {
            participant.setStatus(RoomParticipantStatus.LEFT);
            participant.setLeftAt(Instant.now());
            participantRepository.save(participant);
        }
        return true;
    }

    @Transactional
    public KickResult kickPlayer(UserEntity host, String roomCode, Long userId) {
        if (host == null || roomCode == null || roomCode.isBlank() || userId == null) {
            return new KickResult(null, "bad_request");
        }
        host = lockUser(host);
        RoomEntity room = roomRepository.findLockedByRoomCodeIgnoreCase(roomCode).orElse(null);
        if (room == null) {
            return new KickResult(null, "room_not_found");
        }
        if (room.getHostUser() == null || !room.getHostUser().getId().equals(host.getId())) {
            return new KickResult(null, "not_host");
        }
        if (room.getStatus() == RoomStatus.IN_GAME) {
            return new KickResult(null, "room_in_game");
        }
        RoomParticipantEntity participant = participantRepository.findByRoomAndUserId(room, userId).orElse(null);
        if (participant == null || participant.getStatus() != RoomParticipantStatus.ACTIVE) {
            return new KickResult(null, "not_found");
        }
        if (participant.getRole() == RoomParticipantRole.HOST) {
            return new KickResult(null, "cannot_kick_host");
        }
        participant.setStatus(RoomParticipantStatus.LEFT);
        participant.setLeftAt(Instant.now());
        participantRepository.save(participant);
        return new KickResult(participant.getUser(), null);
    }

    @Transactional
    public StartGameResult startGame(UserEntity host, String roomCode) {
        if (host == null || roomCode == null || roomCode.isBlank()) {
            return new StartGameResult(null, null, "bad_request");
        }
        host = lockUser(host);
        RoomEntity room = roomRepository.findLockedByRoomCodeIgnoreCase(roomCode).orElse(null);
        if (room == null) {
            return new StartGameResult(null, null, "room_not_found");
        }
        if (room.getHostUser() == null || !room.getHostUser().getId().equals(host.getId())) {
            return new StartGameResult(null, null, "not_host");
        }
        if (room.getStatus() == RoomStatus.IN_GAME) {
            return new StartGameResult(null, null, "room_in_game");
        }
        RoomParticipantEntity participant = participantRepository.findFirstByRoomAndStatusAndRole(room, RoomParticipantStatus.ACTIVE, RoomParticipantRole.PLAYER)
                .orElse(null);
        if (participant == null || participant.getUser() == null) {
            return new StartGameResult(null, null, "no_player");
        }
        return new StartGameResult(room, participant.getUser(), null);
    }

    @Transactional
    public void cleanupOldRooms(java.time.Duration maxAge) {
        Instant now = Instant.now();
        List<RoomEntity> rooms = roomRepository.findByStatus(RoomStatus.OPEN);
        for (RoomEntity candidate : rooms) {
            RoomEntity room = roomRepository.findLockedByRoomCodeIgnoreCase(candidate.getRoomCode()).orElse(null);
            if (room == null || room.getStatus() != RoomStatus.OPEN) {
                continue;
            }
            if (room.getCreatedAt() != null && java.time.Duration.between(room.getCreatedAt(), now).compareTo(maxAge) > 0) {
                room.setStatus(RoomStatus.CLOSED);
                room.setUpdatedAt(now);
                roomRepository.save(room);
                List<RoomParticipantEntity> activeParticipants = participantRepository.findByRoomAndStatus(room, RoomParticipantStatus.ACTIVE);
                for (RoomParticipantEntity participant : activeParticipants) {
                    participant.setStatus(RoomParticipantStatus.LEFT);
                    participant.setLeftAt(now);
                    participantRepository.save(participant);
                }
            }
        }
    }

    private boolean isInviteValid(RoomEntity room, String token) {
        if (token == null || token.isBlank()) {
            return false;
        }
        Optional<RoomInviteEntity> inviteOpt = inviteRepository.findByToken(token);
        if (inviteOpt.isEmpty()) {
            return false;
        }
        RoomInviteEntity invite = inviteOpt.get();
        if (!invite.getRoom().getId().equals(room.getId())) {
            return false;
        }
        if (invite.getExpiresAt() != null && invite.getExpiresAt().isBefore(Instant.now())) {
            return false;
        }
        if (invite.getUses() >= invite.getMaxUses()) {
            return false;
        }
        invite.setUses(invite.getUses() + 1);
        inviteRepository.save(invite);
        return true;
    }

    private String normalizeName(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        return name.trim();
    }

    private String normalizePassword(String password) {
        if (password == null || password.isBlank()) {
            return null;
        }
        return password.trim();
    }

    private boolean isActiveInOtherRoom(UserEntity user, RoomEntity targetRoom) {
        if (user == null) {
            return false;
        }
        List<RoomParticipantEntity> active = participantRepository.findByUserIdAndStatus(
                user.getId(),
                RoomParticipantStatus.ACTIVE
        );
        if (active.isEmpty()) {
            return false;
        }
        for (RoomParticipantEntity participant : active) {
            RoomEntity room = participant.getRoom();
            if (room == null) {
                continue;
            }
            if (targetRoom == null || !room.getId().equals(targetRoom.getId())) {
                return true;
            }
        }
        return false;
    }

    private UserEntity lockUser(UserEntity user) {
        if (user == null || user.getId() == null) {
            return user;
        }
        return userRepository.findLockedById(user.getId()).orElse(user);
    }

    public record CreateRoomResult(RoomEntity room, String error) {}

    public record JoinRoomResult(RoomEntity room, String error) {}

    public record KickResult(UserEntity user, String error) {}

    public record StartGameResult(RoomEntity room, UserEntity guest, String error) {}
}
