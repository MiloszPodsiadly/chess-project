# Chess Arena visual and functional review

Browser review recorded at `2026-10-28T11:30:23Z`. Detailed browser data is in [report.json](arena-evidence/report.json), and the earlier live multiplayer run is in [multiplayer-report.json](arena-evidence/multiplayer-report.json). The current automated multiplayer smoke coverage is documented in [multiplayer-e2e.md](multiplayer-e2e.md).

## Landing page

The landing page uses the Chess Arena king mark and the animated arena scene. The two primary actions remain stacked and share the same left edge and width. The browser review checked alignment at all eight viewport sizes, along with English and Polish copy, language persistence, and both navigation actions.

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

The animated arena appears on the landing page and lobby, with reduced-motion and offscreen behavior. Match-found feedback does not block board input or replay after duplicate events.

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
| Lobby | 1440 × 900 | 16.8 ms | 0 |
| Lobby, 4× slowdown | 1440 × 900 | 16.7 ms | 0 |
| Mobile emulation, 4× slowdown | 375 × 667 | 16.7 ms | 0 |
| Waiting fixture, 4× slowdown | 1440 × 900 | 16.7 ms | 0 |

The headless runner reported about 60 frames per second. Mobile used viewport emulation and 4× CPU slowdown on the same laptop; these results are not physical-device measurements. Twenty Home-to-game-to-Home cycles kept DOM nodes at 769 and JavaScript listeners at 15. Used heap rose by about 1.14 MiB; the measurements do not establish a perfectly flat heap over long sessions.

The current production build has an initial bundle of 297.44 kB raw / 82.46 kB estimated transfer and a 22,195 B Arena lazy chunk (7,234 B gzip). Angular reports no component stylesheet budget warning. The remaining CommonJS warning is for `sockjs-client`; it stays because Spring serves the tested STOMP endpoint with SockJS enabled.

## Validation

- Frontend unit suite: 17 files, 96 tests passed.
- Stockfish.js 19 asset and UCI search check: passed.
- Production Angular build: completed with no component stylesheet budget warning; the remaining `sockjs-client` CommonJS warning is documented above.
- Arena browser assertions: language, navigation, all eight landing viewports, animation states, reduced motion, and repeated route transitions passed.
- Multiplayer browser smoke: real host, guest, and spectator contexts verified room membership, two-way chat, synchronized legal moves, wrong-turn rejection, spectator permissions, resignation, and game review. See [multiplayer-e2e.md](multiplayer-e2e.md) for local reproduction and scope limits.
