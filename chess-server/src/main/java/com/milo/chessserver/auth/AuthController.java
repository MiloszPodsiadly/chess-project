package com.milo.chessserver.auth;

import com.milo.chessdomain.user.AuthResponse;
import com.milo.chessdomain.user.LoginRequest;
import com.milo.chessdomain.user.RegisterRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.User;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService service;

    public AuthController(AuthService service) {
        this.service = service;
    }

    @PostMapping("/register")
    public AuthResponse register(@RequestBody RegisterRequest request) {
        return service.register(request);
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest request) {
        return service.login(request);
    }

    @GetMapping("/api-session")
    public java.util.Map<String, String> session(@AuthenticationPrincipal User principal) {
        if (principal == null) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.UNAUTHORIZED);
        return java.util.Map.of("username", principal.getUsername());
    }
}
