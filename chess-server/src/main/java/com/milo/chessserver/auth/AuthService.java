package com.milo.chessserver.auth;

import com.milo.chessdomain.user.AuthResponse;
import com.milo.chessdomain.user.LoginRequest;
import com.milo.chessdomain.user.RegisterRequest;
import com.milo.chessdomain.user.UserPublicDto;
import com.milo.chessserver.user.UserEntity;
import com.milo.chessserver.user.UserRepository;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenService tokenService;
    private final AuthenticationManager authManager;

    public AuthService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       JwtTokenService tokenService,
                       AuthenticationManager authManager) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.tokenService = tokenService;
        this.authManager = authManager;
    }

    public AuthResponse register(RegisterRequest request) {
        if (userRepository.findByUsername(request.username()).isPresent()) {
            throw new IllegalArgumentException("Username already exists");
        }
        if (userRepository.findByEmail(request.email()).isPresent()) {
            throw new IllegalArgumentException("Email already exists");
        }
        UserEntity user = new UserEntity();
        user.setUsername(request.username());
        user.setEmail(request.email());
        user.setPasswordHash(passwordEncoder.encode(request.password()));

        userRepository.save(user);

        String token = tokenService.generateToken(user);
        return new AuthResponse(token, toPublicDto(user));
    }

    public AuthResponse login(LoginRequest request) {
        var authToken = new UsernamePasswordAuthenticationToken(
                request.usernameOrEmail(), request.password());
        authManager.authenticate(authToken);

        UserEntity user = userRepository.findByUsername(request.usernameOrEmail())
                .orElseThrow();

        String token = tokenService.generateToken(user);
        return new AuthResponse(token, toPublicDto(user));
    }

    private UserPublicDto toPublicDto(UserEntity user) {
        return new UserPublicDto(
                user.getId(),
                user.getUsername(),
                user.getRatingRapid(),
                user.getRatingBlitz(),
                user.getRatingVsEngine()
        );
    }
}
