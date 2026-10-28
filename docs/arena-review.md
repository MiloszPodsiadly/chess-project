# Chess Arena visual and functional review

Browser review recorded at `2026-10-28T13:32:07Z`. Detailed browser data is in [report.json](arena-evidence/report.json), and the earlier live multiplayer run is in [multiplayer-report.json](arena-evidence/multiplayer-report.json). The current automated multiplayer smoke coverage is documented in [multiplayer-e2e.md](multiplayer-e2e.md).

## Landing page

The landing page uses the Chess Arena king mark and the animated arena scene. At all eight viewport sizes, the hero copy and stacked action group are centered; both actions have equal width, and each label is centered within its button. The browser review also checked English and Polish copy, language persistence, and both navigation actions.

| View | Screenshot |
| --- | --- |
| English hero | [home-1440x900.png](arena-evidence/home-1440x900.png) |
| Polish hero | [home-polish-1440x900.png](arena-evidence/home-polish-1440x900.png) |
| Polish hero at simulated 200% zoom | [home-polish-zoom-200.png](arena-evidence/home-polish-zoom-200.png) |
| Mobile, 375 × 667 | [home-375x667.png](arena-evidence/home-375x667.png) |
| Mobile, 390 × 844 | [home-390x844.png](arena-evidence/home-390x844.png) |
| Tablet, 768 × 1024 | [home-768x1024.png](arena-evidence/home-768x1024.png) |
| Tablet, 1024 × 768 | [home-1024x768.png](arena-evidence/home-1024x768.png) |
| Desktop, 1280 × 720 | [home-1280x720.png](arena-evidence/home-1280x720.png) |
| Desktop, 1366 × 768 | [home-1366x768.png](arena-evidence/home-1366x768.png) |
| Desktop, 1920 × 1080 | [home-1920x1080.png](arena-evidence/home-1920x1080.png) |

No horizontal overflow was found at these sizes. At simulated 200% browser zoom (720 by 450 CSS viewport), the Polish hero description stayed within the viewport and was not clipped. The report records when vertical scrolling is required. Screenshots capture the full page.

Vertical scrolling is expected at 375 by 667, 390 by 844, and 768 by 1024 in the lobby; at 375 by 667 and 768 by 1024 during active play; and at the 720 by 450 layout viewport used to simulate 200% zoom. No horizontal overflow or clipped Polish hero text was found.

## Arena and multiplayer

The animated arena appears on the landing page and lobby, with reduced-motion and offscreen behavior. The multiplayer lobby and active board were checked at all eight viewport sizes; the board stayed within the viewport without blur, and the report records when vertical scrolling is required. Match-found feedback does not block board input or replay after duplicate events.

The live browser run used independent Chrome clients against the local backend. It verified room creation, host management and deletion, a second player joining, host start, both players receiving the same game with opposite colors, synchronized `e2–e4` and `e7–e5` moves, turn ownership, read-only spectator access, and game completion. It recorded zero browser runtime errors.

| State | Screenshot |
| --- | --- |
| First animation frame | [intro-timeline-zero.png](arena-evidence/intro-timeline-zero.png) |
| Revealed arena | [arena-revealed.png](arena-evidence/arena-revealed.png) |
| Lobby | [lobby-idle.png](arena-evidence/lobby-idle.png) |
| Waiting for opponent | [waiting-for-opponent.png](arena-evidence/waiting-for-opponent.png) |
| Match found | [match-found.png](arena-evidence/match-found.png) |
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
| Mobile emulation, 4× slowdown | 375 × 667 | 16.8 ms | 0 |
| Waiting fixture, 4× slowdown | 1440 × 900 | 16.7 ms | 0 |

The headless runner reported about 60 frames per second. Mobile used viewport emulation and 4× CPU slowdown on the same laptop; these results are not physical-device measurements. Twenty Home-to-game-to-Home cycles kept DOM nodes at 769 and JavaScript listeners at 15. Used heap rose by about 1.12 MiB; the measurements do not establish a perfectly flat heap over long sessions.

The current production build has an initial bundle of 297.63 kB raw / 82.43 kB estimated transfer and a 22,207 B Arena lazy chunk (7,240 B gzip). Angular reports no component stylesheet budget warning. The remaining CommonJS warning is for `sockjs-client`; it stays because Spring serves the tested STOMP endpoint with SockJS enabled.

## Validation

- Frontend unit suite: 19 files, 125 tests passed.
- Stockfish.js 19 asset and UCI search check: passed.
- Production Angular build: completed with no component stylesheet budget warning; the remaining `sockjs-client` CommonJS warning is documented above.
- Arena browser assertions: centered hero copy and action labels, language, navigation, all eight landing, lobby, and active-game viewports; simulated 200% zoom with Polish copy; animation states; reduced motion; and repeated route transitions passed.
- Multiplayer browser smoke: real host, guest, and spectator contexts verified room membership, two-way chat, synchronized legal moves, wrong-turn rejection, spectator permissions, resignation, and game review. See [multiplayer-e2e.md](multiplayer-e2e.md) for local reproduction and scope limits.
