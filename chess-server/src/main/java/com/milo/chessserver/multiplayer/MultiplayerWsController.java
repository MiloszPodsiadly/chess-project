package com.milo.chessserver.multiplayer;

import com.milo.chessdomain.multiplayer.*;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.Principal;

@Controller
public class MultiplayerWsController {

    private static final Logger log = LoggerFactory.getLogger(MultiplayerWsController.class);

    private final MultiplayerService multiplayerService;

    public MultiplayerWsController(MultiplayerService multiplayerService) {
        this.multiplayerService = multiplayerService;
    }

    @MessageMapping("hello/auth")
    public void hello(Principal principal,
                      @Payload HelloAuthRequest request) {
        multiplayerService.handleHello(sessionKey(principal), request);
    }

    @MessageMapping("createRoom")
    public void createRoom(Principal principal,
                           @Payload CreateRoomRequest request) {
        log.info("WS createRoom from session={}, timeControl={}, public={}",
                principal != null ? principal.getName() : null,
                request != null ? request.timeControlType() : null,
                request != null ? request.isPublic() : null);
        String code = multiplayerService.createRoom(sessionKey(principal), request);
        if (code != null) {
            multiplayerService.sendEventToUser(sessionKey(principal), new WsEvent("roomCreated", code));
        }
    }

    @MessageMapping("joinRoom")
    public void joinRoom(Principal principal,
                         @Payload JoinRoomRequest request) {
        log.info("WS joinRoom from session={}, roomCode={}", sessionKey(principal),
                request != null ? request.roomCode() : null);
        multiplayerService.joinRoom(sessionKey(principal), request);
    }

    @MessageMapping("queueMatchmaking")
    public void queue(Principal principal,
                      @Payload QueueMatchmakingRequest request) {
        log.info("WS queueMatchmaking from session={}, timeControl={}", principal != null ? principal.getName() : null,
                request != null ? request.timeControlType() : null);
        multiplayerService.queueMatchmaking(sessionKey(principal), request);
    }

    @MessageMapping("cancelMatchmaking")
    public void cancelMatchmaking(Principal principal) {
        multiplayerService.cancelMatchmaking(sessionKey(principal));
    }

    @MessageMapping("makeMove")
    public void makeMove(Principal principal,
                         @Payload MakeMoveRequest request) {
        multiplayerService.makeMove(sessionKey(principal), request);
    }

    @MessageMapping("resign")
    public void resign(Principal principal,
                       @Payload ResignRequest request) {
        multiplayerService.resign(sessionKey(principal), request);
    }

    @MessageMapping("offerDraw")
    public void offerDraw(Principal principal,
                          @Payload OfferDrawRequest request) {
        multiplayerService.offerDraw(sessionKey(principal), request);
    }

    @MessageMapping("acceptDraw")
    public void acceptDraw(Principal principal,
                           @Payload AcceptDrawRequest request) {
        multiplayerService.acceptDraw(sessionKey(principal), request);
    }

    @MessageMapping("declineDraw")
    public void declineDraw(Principal principal,
                            @Payload DeclineDrawRequest request) {
        multiplayerService.declineDraw(sessionKey(principal), request);
    }

    @MessageMapping("requestSync")
    public void requestSync(Principal principal,
                            @Payload RequestSyncRequest request) {
        multiplayerService.requestSync(sessionKey(principal), request);
    }

    @MessageMapping("listRooms")
    public void listRooms(Principal principal,
                          @Payload(required = false) ListRoomsRequest request) {
        multiplayerService.listRooms(sessionKey(principal));
    }

    @MessageMapping("createInvite")
    public void createInvite(Principal principal,
                             @Payload CreateInviteRequest request) {
        multiplayerService.createInvite(sessionKey(principal), request);
    }

    @MessageMapping("spectateRoom")
    public void spectateRoom(Principal principal,
                             @Payload SpectateRoomRequest request) {
        multiplayerService.spectateRoom(sessionKey(principal), request);
    }

    @MessageMapping("roomMessage")
    public void roomMessage(Principal principal,
                            @Payload SendRoomMessageRequest request) {
        multiplayerService.sendRoomMessage(sessionKey(principal), request);
    }

    @MessageMapping("roomHistory")
    public void roomHistory(Principal principal,
                            @Payload RoomHistoryRequest request) {
        multiplayerService.roomHistory(sessionKey(principal), request);
    }

    @MessageMapping("leaveRoom")
    public void leaveRoom(Principal principal,
                          @Payload LeaveRoomRequest request) {
        multiplayerService.leaveRoom(sessionKey(principal), request);
    }

    @MessageMapping("roomParticipants")
    public void roomParticipants(Principal principal,
                                 @Payload RoomParticipantsRequest request) {
        multiplayerService.roomParticipants(sessionKey(principal), request);
    }

    @MessageMapping("kickPlayer")
    public void kickPlayer(Principal principal,
                           @Payload KickPlayerRequest request) {
        multiplayerService.kickPlayer(sessionKey(principal), request);
    }

    @MessageMapping("deleteRoom")
    public void deleteRoom(Principal principal,
                           @Payload DeleteRoomRequest request) {
        multiplayerService.deleteRoom(sessionKey(principal), request);
    }

    @MessageMapping("startRoomGame")
    public void startRoomGame(Principal principal,
                              @Payload StartRoomGameRequest request) {
        log.info("WS startRoomGame from session={}, roomCode={}", sessionKey(principal),
                request != null ? request.roomCode() : null);
        multiplayerService.startRoomGame(sessionKey(principal), request);
    }

    private String sessionKey(Principal principal) {
        return principal == null ? null : principal.getName();
    }
}
