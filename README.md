# Chess Project

Play a quick game, challenge Stockfish 19, or meet another player online. I built Chess Project to make each of those experiences feel at home on the same board.

## Take a look

![Chess Project screenshot 1](chess-web/public/assets/screens/Screen1.png)

![Chess Project screenshot 2](chess-web/public/assets/screens/Screen2.png)

![Chess Project screenshot 3](chess-web/public/assets/screens/Screen3.png)

![Chess Project screenshot 4](chess-web/public/assets/screens/Screen4.png)

## Play your way

- **On your own:** play on the local board or challenge Stockfish.js 19 in your browser without creating an account.
- **Against Stockfish 19:** sign in for saved games against the native engine. Choose a beginner or training level, or try Strong, Expert, Ultimate, and Deep Challenge at full strength.
- **With other players:** create or join an online room, use matchmaking, and return to a game after reconnecting.
- **Learn from your moves:** follow the evaluation, best move, and variations in the optional analysis panel.

The interface supports English and Polish. Guest games run locally; signed-in bot games and online games are saved on the server.

## Get started

Install Docker and Docker Compose, then run:

```bash
docker compose up --build -d
```

Open **http://localhost:3000**. The build includes both engines, so there is no separate Stockfish setup. Stop the app with `docker compose down`; your database volume stays in place.

## Engine source and licenses

The application code is available under the [MIT License](LICENSE). Stockfish is separate software under GPLv3.

The native Docker image builds [Stockfish 19 from this pinned source commit](https://github.com/official-stockfish/Stockfish/commit/edb0d9db6731067ec50ce619ff372b463bc4dd5d). Its exact source archive and GPLv3 license are included in the image at `/usr/share/doc/stockfish/source.tar.gz` and `/usr/share/doc/stockfish/Copying.txt`.

The browser engine uses [Stockfish.js 19.0.1](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1), pinned in `chess-web/package-lock.json`. Its GPLv3 license is served at `/stockfish/Copying.txt`, and its [source code is available here](https://github.com/nmrugg/stockfish.js/tree/v19.0.1).

**Made by Miłosz Podsiadły.**