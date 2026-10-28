# Multiplayer browser smoke test

The `multiplayer-e2e` GitHub Actions job runs a real Chromium browser against the Spring Boot server and an isolated PostgreSQL 16 service. It creates independent browser contexts for the host, guest, and spectator. Room operations, chat, moves, spectator permissions, resignation, and review are exercised through accessible UI controls. The test does not use Angular debug globals or mocked server state.

The suite also checks desktop lobby containment in English and Polish, native browser scrollbars, stable board alignment across ten viewport sizes, and the Arena's dimensions from its first rendered frame during repeated mode switches. A delayed real connection handshake verifies that connecting does not resize the Arena or reveal passive connection banners.

The app served by Docker is available at `http://localhost:3000`; its frontend proxies `/ws` to Spring Boot. The local test command below uses Angular's dev server on `http://localhost:4200` and connects directly to Spring Boot on port 8080. Port 4200 is only the test/dev-server address.

The browser keeps `sockjs-client` because Spring currently exposes `/ws` with `.withSockJS()`, so SockJS is the active STOMP transport and preserves its fallback options. The real-browser smoke test exercises this pairing. Removing SockJS would require changing and revalidating both ends of the transport.

## Run locally

Start the local PostgreSQL service:

```powershell
docker compose up -d postgres
```

In a second PowerShell window, configure the development server and start Spring Boot:

```powershell
$env:SPRING_PROFILES_ACTIVE = 'dev'
$env:SPRING_DATASOURCE_URL = 'jdbc:postgresql://localhost:5432/chessdb'
$env:SPRING_DATASOURCE_USERNAME = 'user'
$env:SPRING_DATASOURCE_PASSWORD = 'password'
$env:JWT_SECRET = 'local-e2e-only-secret-keep-out-of-production-2026'
$env:CHESS_ALLOWED_ORIGINS = 'http://localhost:4200'
./gradlew.bat :chess-server:bootRun --no-daemon
```

In another window, install the frontend dependencies and run the browser check. Playwright starts the Angular development server if one is not already running on port 4200:

```powershell
cd chess-web
npm ci
npx playwright install chromium
npm run test:e2e:multiplayer
```

The backend must be reachable at `http://localhost:8080`; the default test frontend uses `http://localhost:4200` because the multiplayer transport resolves the local Spring endpoint from that origin. To run the same smoke test against the Docker app on port 3000, set `$env:MULTIPLAYER_BASE_URL = 'http://localhost:3000'` before invoking `npm run test:e2e:multiplayer`. The test uses randomly named rooms and players.

Playwright writes its HTML report to `chess-web/playwright-report/`. On failure it saves screenshots, a trace, and UI diagnostics under `chess-web/test-results/multiplayer/`; open a trace with `npx playwright show-trace <trace.zip>`.

For screenshot reviews against an isolated stack, set `MULTIPLAYER_EVIDENCE_DIR` to the output directory. The live multiplayer scenario then captures public rooms, room chat, management, active play and spectator views, and writes `multiplayer-report.json`. These captures use actual server-created rooms and readable player names.

## Coverage boundary

This PR gate covers room creation and joining, competing join attempts, initial participant state, two-way chat, authoritative move synchronization for `e2-e4` and `e7-e5`, wrong-turn rejection, spectator read-only behavior and absence of player-only controls, resignation delivery, finished-game replay, Online-to-Bot-to-Online recovery, and refresh during an active game. Detailed reconnect timing, unauthorized raw STOMP subscription attacks, checkmate/draw permutations, and long-running visual/performance reviews remain covered by their focused backend/unit or manual evidence checks rather than this bounded browser smoke.
