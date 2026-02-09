package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.GameStateDto;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.User;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/engine-games")
public class EngineGameController {

    private final EngineGameService gameService;
    private final UserRepository userRepository;

    public EngineGameController(EngineGameService gameService,
                                UserRepository userRepository) {
        this.gameService = gameService;
        this.userRepository = userRepository;
    }

    @PostMapping
    public GameStateDto createGame(@RequestParam(defaultValue = "WHITE") Color playerColor,
                                   @RequestParam(defaultValue = "2400") int engineElo,
                                   @RequestParam(defaultValue = "RAPID") com.milo.chessdomain.TimeControlType timeControlType,
                                   @AuthenticationPrincipal User principal) {

        UserEntity user = userRepository.findByUsername(principal.getUsername())
                .orElseThrow();

        return gameService.startNewVsEngineGame(user, playerColor, engineElo, timeControlType);
    }

    @PostMapping("/{id}/move")
    public GameStateDto makeMove(@PathVariable UUID id,
                                 @RequestParam(defaultValue = "2400") int engineElo,
                                 @RequestParam(defaultValue = "RAPID") com.milo.chessdomain.TimeControlType timeControlType,
                                 @RequestBody MoveDto move,
                                 @AuthenticationPrincipal User principal) {

        UserEntity user = userRepository.findByUsername(principal.getUsername())
                .orElseThrow();

        return gameService.playerMove(id, user, move, engineElo, timeControlType);
    }
}
