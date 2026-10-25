package com.milo.chessserver.game;

import com.milo.chessdomain.Color;
import com.milo.chessdomain.game.GameStateDto;
import com.milo.chessdomain.game.MoveDto;
import com.milo.chessengine.config.EngineStrength;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.User;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

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
                                   @RequestParam(required = false) EngineStrength.Mode mode,
                                   @RequestParam(defaultValue = "STRONG") EngineStrength.Preset preset,
                                   @RequestParam(defaultValue = "RAPID") com.milo.chessdomain.TimeControlType timeControlType,
                                   @AuthenticationPrincipal User principal) {

        UserEntity user = userRepository.findByUsername(principal.getUsername())
                .orElseThrow();

        return gameService.startNewVsEngineGame(user, playerColor, engineElo, timeControlType, mode, preset);
    }

    @PostMapping("/{id}/move")
    public GameStateDto makeMove(@PathVariable UUID id,
                                 @RequestParam(required = false) Long expectedVersion,
                                 @RequestBody MoveDto move,
                                 @AuthenticationPrincipal User principal) {

        UserEntity user = userRepository.findByUsername(principal.getUsername())
                .orElseThrow();

        return gameService.playerMove(id, user, move, expectedVersion);
    }

    @GetMapping("/{id}")
    public GameStateDto get(@PathVariable UUID id, @AuthenticationPrincipal User principal) {
        return gameService.getGame(id, userRepository.findByUsername(principal.getUsername()).orElseThrow());
    }

    @PostMapping("/{id}/retry")
    public GameStateDto retry(@PathVariable UUID id, @AuthenticationPrincipal User principal) {
        return gameService.retryEngineTurn(id, userRepository.findByUsername(principal.getUsername()).orElseThrow());
    }

    @PostMapping("/{id}/resign")
    public GameStateDto resign(@PathVariable UUID id, @AuthenticationPrincipal User principal) {
        return gameService.resign(id, userRepository.findByUsername(principal.getUsername()).orElseThrow());
    }

    @PostMapping("/{id}/restart")
    public GameStateDto restart(@PathVariable UUID id, @AuthenticationPrincipal User principal) {
        return gameService.restart(id, userRepository.findByUsername(principal.getUsername()).orElseThrow());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<java.util.Map<String, String>> invalidConfiguration(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(java.util.Map.of("error", ex.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<java.util.Map<String, String>> conflictingTurn(IllegalStateException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(java.util.Map.of("error", ex.getMessage()));
    }
}
