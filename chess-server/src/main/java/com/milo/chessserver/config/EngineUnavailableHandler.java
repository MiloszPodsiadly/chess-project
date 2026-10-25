package com.milo.chessserver.config;

import com.milo.chessengine.impl.EngineUnavailableException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class EngineUnavailableHandler {
    @ExceptionHandler(EngineUnavailableException.class)
    public ResponseEntity<Map<String, String>> unavailable(EngineUnavailableException ex) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "engine_unavailable", "message", ex.getMessage()));
    }
}
