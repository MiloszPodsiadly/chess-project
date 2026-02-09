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
        log.info("WS hello/auth from session={}, user={}, token={}", principal != null ? principal.getName() : null,
                request != null ? request.username() : null,
                request != null ? request.reconnectToken() : null);
        multiplayerService.handleHello(principal.getName(), request);
    }

    @MessageMapping("createRoom")
    public void createRoom(Principal principal,
                           @Payload CreateRoomRequest request) {
        log.info("WS createRoom from session={}, timeControl={}, public={}",
                principal != null ? principal.getName() : null,
                request != null ? request.timeControlType() : null,
                request != null ? request.isPublic() : null);
        String code = multiplayerService.createRoom(principal.getName(), request);
        if (code != null) {
            multiplayerService.sendEventToUser(principal.getName(), new WsEvent("roomCreated", code));
        }
    }

    @MessageMapping("joinRoom")
    public void joinRoom(Principal principal,
                         @Payload JoinRoomRequest request) {
        log.info("WS joinRoom from session={}, roomCode={}", principal != null ? principal.getName() : null,
                request != null ? request.roomCode() : null);
        multiplayerService.joinRoom(principal.getName(), request);
    }

    @MessageMapping("queueMatchmaking")
    public void queue(Principal principal,
                      @Payload QueueMatchmakingRequest request) {
        log.info("WS queueMatchmaking from session={}, timeControl={}", principal != null ? principal.getName() : null,
                request != null ? request.timeControlType() : null);
        multiplayerService.queueMatchmaking(principal.getName(), request);
    }

    @MessageMapping("makeMove")
    public void makeMove(Principal principal,
                         @Payload MakeMoveRequest request) {
        multiplayerService.makeMove(principal.getName(), request);
    }

    @MessageMapping("resign")
    public void resign(Principal principal,
                       @Payload ResignRequest request) {
        multiplayerService.resign(principal.getName(), request);
    }

    @MessageMapping("offerDraw")
    public void offerDraw(Principal principal,
                          @Payload OfferDrawRequest request) {
        multiplayerService.offerDraw(principal.getName(), request);
    }

    @MessageMapping("acceptDraw")
    public void acceptDraw(Principal principal,
                           @Payload AcceptDrawRequest request) {
        multiplayerService.acceptDraw(principal.getName(), request);
    }

    @MessageMapping("declineDraw")
    public void declineDraw(Principal principal,
                            @Payload DeclineDrawRequest request) {
        multiplayerService.declineDraw(principal.getName(), request);
    }

    @MessageMapping("requestSync")
    public void requestSync(Principal principal,
                            @Payload RequestSyncRequest request) {
        multiplayerService.requestSync(principal.getName(), request);
    }

    @MessageMapping("listRooms")
    public void listRooms(Principal principal,
                          @Payload(required = false) ListRoomsRequest request) {
        multiplayerService.listRooms(principal.getName());
    }

    @MessageMapping("createInvite")
    public void createInvite(Principal principal,
                             @Payload CreateInviteRequest request) {
        multiplayerService.createInvite(principal.getName(), request);
    }

    @MessageMapping("spectateRoom")
    public void spectateRoom(Principal principal,
                             @Payload SpectateRoomRequest request) {
        multiplayerService.spectateRoom(principal.getName(), request);
    }

    @MessageMapping("roomMessage")
    public void roomMessage(Principal principal,
                            @Payload SendRoomMessageRequest request) {
        multiplayerService.sendRoomMessage(principal.getName(), request);
    }

    @MessageMapping("roomHistory")
    public void roomHistory(Principal principal,
                            @Payload RoomHistoryRequest request) {
        multiplayerService.roomHistory(principal.getName(), request);
    }

    @MessageMapping("leaveRoom")
    public void leaveRoom(Principal principal,
                          @Payload LeaveRoomRequest request) {
        multiplayerService.leaveRoom(principal.getName(), request);
    }

    @MessageMapping("roomParticipants")
    public void roomParticipants(Principal principal,
                                 @Payload RoomParticipantsRequest request) {
        multiplayerService.roomParticipants(principal.getName(), request);
    }

    @MessageMapping("kickPlayer")
    public void kickPlayer(Principal principal,
                           @Payload KickPlayerRequest request) {
        multiplayerService.kickPlayer(principal.getName(), request);
    }

    @MessageMapping("deleteRoom")
    public void deleteRoom(Principal principal,
                           @Payload DeleteRoomRequest request) {
        multiplayerService.deleteRoom(principal.getName(), request);
    }

    @MessageMapping("startRoomGame")
    public void startRoomGame(Principal principal,
                              @Payload StartRoomGameRequest request) {
        log.info("WS startRoomGame from session={}, roomCode={}",
                principal != null ? principal.getName() : null,
                request != null ? request.roomCode() : null);
        multiplayerService.startRoomGame(principal.getName(), request);
    }
}
