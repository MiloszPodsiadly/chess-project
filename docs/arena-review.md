# Chess Arena visual and functional review

Browser review recorded at `2026-10-27T23:16:22Z`. Detailed browser data is in [report.json](arena-evidence/report.json), and the live multiplayer run is in [multiplayer-report.json](arena-evidence/multiplayer-report.json).

## Landing page

The landing page uses the Chess Arena king mark and the animated arena scene. The two primary actions remain stacked and share the same left edge and width. The Stockfish and online-room feature chips shown in the earlier design have been removed. The browser review checked alignment and chip removal at all eight viewport sizes, along with English and Polish copy, language persistence, and both navigation actions.

| View | Screenshot |
| --- | --- |
| English hero | [home-1440x900.png](arena-evidence/home-1440x900.png) |
| Polish hero | [home-polish-1440x900.png](arena-evidence/home-polish-1440x900.png) |
| Mobile, 375 × 667 | [home-375x667.png](arena-evidence/home-375x667.png) |
| Mobile, 390 × 844 | [home-390x844.png](arena-evidence/home-390x844.png) |
| Tablet, 768 × 1024 | [home-768x1024.png](arena-evidence/home-768x1024.png) |
| Tablet, 1024 × 768 | [home-1024x768.png](arena-evidence/home-1024x768.png) |
| Desktop, 1280 × 720 | [home-1280x720.png](arena-evidence/home-1280x720.png) |
| Desktop, 1366 × 768 | [home-1366x768.png](arena-evidence/home-1366x768.png) |
| Desktop, 1920 × 1080 | [home-1920x1080.png](arena-evidence/home-1920x1080.png) |

No horizontal overflow was found at these sizes. The screenshots capture the full page.

## Arena and multiplayer

The shared inline SVG arena is deferred on the landing page and lobby, and removed during an active game. Reduced-motion and offscreen behavior were checked. Match-found feedback does not block board input or replay after duplicate events.

The live browser run used independent Chrome clients against the local backend. It verified room creation, host management and deletion, a second player joining, host start, both players receiving the same game with opposite colors, synchronized `e2–e4` and `e7–e5` moves, turn ownership, read-only spectator access, and game completion. It recorded zero browser runtime errors.

| State | Screenshot |
| --- | --- |
| First animation frame | [intro-timeline-zero.png](arena-evidence/intro-timeline-zero.png) |
| Revealed arena | [arena-revealed.png](arena-evidence/arena-revealed.png) |
| Lobby | [lobby-idle.png](arena-evidence/lobby-idle.png) |
| Waiting for opponent | [waiting-for-opponent.png](arena-evidence/waiting-for-opponent.png) |
| Match found | [match-found.png](arena-evidence/match-found.png) |
| Active game | [active-game.png](arena-evidence/active-game.png) |
| Reconnecting | [reconnecting.png](arena-evidence/reconnecting.png) |
| Reduced motion | [reduced-motion.png](arena-evidence/reduced-motion.png) |
| Room management | [multiplayer-room-management.png](arena-evidence/multiplayer-room-management.png) |
| Multiplayer game | [multiplayer-live-game.png](arena-evidence/multiplayer-live-game.png) |
| Read-only spectator | [multiplayer-spectator.png](arena-evidence/multiplayer-spectator.png) |

## Performance and memory

The Arena review ran in headless Chrome 156 on Windows with an AMD Ryzen 5 8645HS and 31.3 GiB RAM. Mobile used viewport emulation and 4× CPU slowdown on that same laptop; these results do not represent measurements on a physical phone.

| Scenario | Viewport | p95 frame time | Long tasks |
| --- | ---: | ---: | ---: |
| Lobby | 1440 × 900 | 7.1 ms | 0 |
| Lobby, 4× slowdown | 1440 × 900 | 7.1 ms | 0 |
| Mobile emulation, 4× slowdown | 375 × 667 | 7.1 ms | 0 |
| Waiting fixture, 4× slowdown | 1440 × 900 | 7.1 ms | 0 |

The headless runner reported about 144 frames per second, which reflects its frame scheduler rather than a device performance claim. Twenty Home-to-game-to-Home cycles kept DOM nodes at 769 and JavaScript listeners at 15. Used heap rose by about 0.92 MiB; the measurements do not establish a perfectly flat heap over long sessions.

The production build completed with an initial bundle of 297.44 kB raw / 82.45 kB estimated transfer. The Arena lazy chunk is 22,195 B raw / 7,234 B gzip. Angular reported the game page stylesheet at 16.34 kB, 339 B above its 16 kB warning budget, and the existing CommonJS optimization warning for `sockjs-client`.

## Validation

- Frontend unit suite: 16 files, 94 tests passed.
- Stockfish.js 19 asset and UCI search check: passed.
- Production Angular build: completed; see the stylesheet and CommonJS warnings above.
- Arena browser assertions: language, navigation, all eight landing viewports, animation states, reduced motion, and route cleanup passed.
- Multiplayer browser assertions: room management, two-player play, move synchronization, spectator permissions, and match completion passed.
