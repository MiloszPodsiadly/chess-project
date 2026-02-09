package com.milo.chessserver.config;

import jakarta.servlet.http.HttpSession;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;

import java.security.Principal;
import java.util.Map;
import java.util.UUID;

public class WebSocketPrincipalHandshakeHandler extends DefaultHandshakeHandler {

    @Override
    protected Principal determineUser(ServerHttpRequest request,
                                      WebSocketHandler wsHandler,
                                      Map<String, Object> attributes) {
        if (request instanceof ServletServerHttpRequest servletRequest) {
            HttpSession session = servletRequest.getServletRequest().getSession(true);
            if (session != null) {
                return session::getId;
            }
        }
        String existing = attributes != null ? (String) attributes.get("wsPrincipal") : null;
        if (existing == null || existing.isBlank()) {
            existing = UUID.randomUUID().toString();
            if (attributes != null) {
                attributes.put("wsPrincipal", existing);
            }
        }
        String principalName = existing;
        return () -> principalName;
    }
}
