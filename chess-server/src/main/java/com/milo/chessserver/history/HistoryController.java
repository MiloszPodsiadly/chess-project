package com.milo.chessserver.history;

import com.milo.chessdomain.game.GameSummaryDto;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.User;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/history")
public class HistoryController {

    private final HistoryService historyService;
    private final UserRepository userRepository;

    public HistoryController(HistoryService historyService,
                             UserRepository userRepository) {
        this.historyService = historyService;
        this.userRepository = userRepository;
    }

    @GetMapping("/my")
    public List<GameSummaryDto> getMyHistory(@AuthenticationPrincipal User principal,
                                             @RequestParam(required = false) Integer page,
                                             @RequestParam(required = false) Integer size,
                                             @RequestParam(required = false) com.milo.chessdomain.GameType gameType,
                                             @RequestParam(required = false) com.milo.chessdomain.TimeControlType timeControlType,
                                             @RequestParam(required = false) com.milo.chessdomain.GameResult result) {
        UserEntity user = userRepository.findByUsername(principal.getUsername())
                .orElseThrow();
        return historyService.getUserHistory(user, page, size, gameType, timeControlType, result);
    }
}
