package com.milo.chessserver.config;

import org.junit.jupiter.api.Test;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;

import java.security.Principal;
import java.util.HashMap;

import static org.junit.jupiter.api.Assertions.assertNotEquals;

class WebSocketPrincipalHandshakeHandlerTest {

    @Test
    void givesEachSocketASeparateIdentityEvenWhenBrowserSessionsAreShared() {
        MockHttpServletRequest servletRequest = new MockHttpServletRequest();
        servletRequest.setRequestURI("/ws");
        servletRequest.setSession(new MockHttpSession());
        ServerHttpRequest request = new ServletServerHttpRequest(servletRequest);
        TestableHandshakeHandler handler = new TestableHandshakeHandler();

        Principal firstSocket = handler.determineUser(request);
        Principal secondSocket = handler.determineUser(request);

        assertNotEquals(firstSocket.getName(), secondSocket.getName());
    }

    private static final class TestableHandshakeHandler extends WebSocketPrincipalHandshakeHandler {
        private Principal determineUser(ServerHttpRequest request) {
            return super.determineUser(request, null, new HashMap<>());
        }
    }
}
