# Chess Project

Play a quick game, challenge Stockfish 19, or meet another player online. I built Chess Project to make each of those experiences feel at home on the same board.

## Take a look

![Chess Project screenshot 1](chess-web/public/assets/screens/Screen1.png)

![Chess Project screenshot 2](chess-web/public/assets/screens/Screen2.png)

![Chess Project screenshot 3](chess-web/public/assets/screens/Screen3.png)

![Chess Project screenshot 4](chess-web/public/assets/screens/Screen4.png)

## Play your way

- **On your own:** play on the local board or challenge Stockfish.js 19 in your browser without creating an account.
- **Against Stockfish 19:** choose a custom level from 200 to 3190 or play against unrestricted Stockfish. Browser Lite starts quickly, Browser Full brings a larger engine, and Native offers server-side thinking time for signed-in games. Level ranges describe settings rather than measured FIDE ratings.
- **With other players:** create or join an online room, use matchmaking, and return to a game after reconnecting.
- **Learn from your moves:** follow the evaluation, best move, and variations in the optional analysis panel.

The interface supports English and Polish. Guest games run locally; signed-in bot games and online games are saved on the server.

Native training levels from 1320 to 3190 are sent as Stockfish `UCI_Elo` settings; they are requested engine settings, not measured playing ratings. Native search budgets are selectable per move (3, 10, 30, or 60 seconds). Search depth and actual duration vary with the position and hardware, and the project does not claim an independently measured playing strength.

## Get started

Install Docker and Docker Compose, then run:

```bash
docker compose up --build -d
```

Open **http://localhost:3000**. The build includes both engines, so there is no separate Stockfish setup. Stop the app with `docker compose down`; your database volume stays in place.

Docker Compose uses a local development profile. For another deployment, set `JWT_SECRET`, `DB_USER`, `DB_PASSWORD`, `SPRING_DATASOURCE_URL`, and `CHESS_ALLOWED_ORIGINS` in its environment. `CHESS_ALLOWED_ORIGINS` is a comma-separated list of exact browser origins allowed to connect to the WebSocket endpoint.

Multiplayer reconnect tokens are single-use 256-bit credentials. A successful reconnect rotates the token and returns the replacement; the previous value immediately stops working. Guest display names are labels only and never identify or authenticate an account.

The matchmaking queue is held in backend memory and is shared only by requests handled by the same running server process. Run one backend instance for matchmaking; queued searches are cleared when that process restarts. Rooms, invitations, and game state are stored in the database. Supporting matchmaking across multiple backend instances requires shared queue coordination, which is not configured here.

## Engine source and licenses

The application code is available under the [MIT License](LICENSE). Stockfish is separate software under GPLv3.

The native Docker image builds [Stockfish 19 from this pinned source commit](https://github.com/official-stockfish/Stockfish/commit/edb0d9db6731067ec50ce619ff372b463bc4dd5d). Its exact source archive and GPLv3 license are included in the image at `/usr/share/doc/stockfish/source.tar.gz` and `/usr/share/doc/stockfish/Copying.txt`.

The browser engine uses [Stockfish.js 19.0.1](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1), pinned in `chess-web/package-lock.json`. Its GPLv3 license is served at `/stockfish/Copying.txt`, and its [source code is available here](https://github.com/nmrugg/stockfish.js/tree/v19.0.1).

**Made by Miłosz Podsiadły.**
