import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const summarizeStompFrame = (payload) => {
  if (typeof payload !== 'string') return {};
  const framed = payload.startsWith('a') ? payload.slice(1) : payload;
  let messages;
  try { messages = JSON.parse(framed); } catch { messages = [framed]; }
  const frame = Array.isArray(messages) ? messages.find((message) => typeof message === 'string') : null;
  if (!frame) return {};
  const command = frame.split('\n', 1)[0];
  const separator = frame.indexOf('\n\n');
  const headers = separator < 0 ? [] : frame.slice(0, separator).split('\n');
  const destination = headers.find(header => header.startsWith('destination:'))?.slice('destination:'.length);
  if (command !== 'MESSAGE') return { command, destination };
  if (separator < 0) return { command };
  try {
    const body = JSON.parse(frame.slice(separator + 2).replace(/\0+$/, ''));
    return { command, destination, eventType: typeof body.type === 'string' ? body.type : 'unknown' };
  } catch {
    return { command, eventType: 'unparseable' };
  }
};

const observeOnlineAcknowledgements = (page) => {
  const acknowledgements = { count: 0 };
  page.on('websocket', socket => socket.on('framereceived', frame => {
    if (summarizeStompFrame(frame.payload).eventType === 'helloAck') acknowledgements.count += 1;
  }));
  return acknowledgements;
};

const expectLobbyFitsViewport = async (page) => {
  await expect.poll(() => page.evaluate(() => {
    const sidebar = document.querySelector('.right-panel.online-lobby-layout');
    const panel = document.querySelector('.online-lobby-panel');
    return {
      pageFits: document.documentElement.scrollHeight <= innerHeight + 1
        && document.documentElement.scrollWidth <= innerWidth + 1,
      sidebarFits: sidebar.scrollHeight <= sidebar.clientHeight + 1,
      panelFits: !panel || panel.scrollHeight <= panel.clientHeight + 1
    };
  })).toEqual({ pageFits: true, sidebarFits: true, panelFits: true });
  await expect(page.locator('.online-quick-actions button')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('textbox', { name: /^(Username \(optional\)|Nazwa \(opcjonalnie\))$/ }))
    .toBeInViewport({ ratio: 1 });
};

test('desktop lobby keeps its controls and forms in the viewport without an outer scrollbar', async ({ page }) => {
  await page.goto('/game?mode=online');
  await expect(page.locator('app-multiplayer-lobby')).toBeVisible();
  for (const [width, height] of [[1024, 768], [1280, 600], [1280, 720], [1366, 768], [1440, 900], [1536, 720], [1920, 1080]]) {
    await test.step(`${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      await expectLobbyFitsViewport(page);
      const arena = page.locator('.arena-fit-stage figure');
      await expect(arena).toBeInViewport({ ratio: 1 });
      await expect(arena.locator('.arena-caption')).toHaveCount(0);
      const bottomSpace = await page.evaluate(() =>
        document.querySelector('.right-panel').getBoundingClientRect().bottom
        - document.querySelector('.settings-card').getBoundingClientRect().bottom);
      expect(bottomSpace).toBeGreaterThanOrEqual(40);
      expect(bottomSpace).toBeLessThanOrEqual(41);
      for (const tab of ['Public rooms', 'Create', 'Join', 'Manage']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expectLobbyFitsViewport(page);
        if (tab === 'Public rooms') {
          await expect(page.locator('.room-chat--embedded .chat-input')).toBeInViewport({ ratio: 1 });
        } else if (tab === 'Create') {
          await page.getByLabel('Public room', { exact: true }).uncheck();
          await expect(page.getByLabel('Room password', { exact: true })).toBeInViewport({ ratio: 1 });
          await expect(page.getByLabel('Room name', { exact: true })).toBeInViewport({ ratio: 1 });
          await expectLobbyFitsViewport(page);
        } else if (tab === 'Join') {
          await expect(page.getByLabel('Join password', { exact: true })).toBeInViewport({ ratio: 1 });
          await expect(page.getByLabel('Room code', { exact: true })).toBeInViewport({ ratio: 1 });
        }
      }
      await page.getByRole('tab', { name: 'Manage', exact: true }).click();
    });
  }
});

test('Polish lobby keeps longer labels and password fields inside smaller desktop windows', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lang', 'pl'));
  await page.goto('/game?mode=online');
  await expect(page.getByRole('tab', { name: 'Publiczne pokoje', exact: true })).toBeVisible();
  for (const [width, height] of [[1024, 768], [1280, 600], [1536, 720]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('tab', { name: 'Publiczne pokoje', exact: true }).click();
    await expectLobbyFitsViewport(page);
    await expect(page.locator('.room-chat--embedded .chat-input')).toBeInViewport({ ratio: 1 });
    await page.getByRole('tab', { name: 'Utworz', exact: true }).click();
    await page.getByLabel('Pokoj publiczny', { exact: true }).uncheck();
    await expect(page.getByLabel('Haslo pokoju', { exact: true })).toBeInViewport({ ratio: 1 });
    await expectLobbyFitsViewport(page);
    await page.getByRole('tab', { name: 'Dolacz', exact: true }).click();
    await expect(page.getByLabel('Haslo do pokoju', { exact: true })).toBeInViewport({ ratio: 1 });
    await expectLobbyFitsViewport(page);
  }
});

test('Arena stays the same size when multiplayer finishes connecting after a mode switch', async ({ browser }) => {
  for (const [width, height] of [[1280, 600], [1536, 720], [1440, 900]]) {
    await test.step(`${width}x${height}`, async () => {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const acknowledgements = observeOnlineAcknowledgements(page);
      const arenaLayout = () => page.evaluate(() =>
        ['.arena-fit-stage figure', '.arena-fit-stage .arena-art', '.settings-card'].map(selector => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height };
        }));
      let releaseHandshake;
      const handshake = new Promise(resolve => { releaseHandshake = resolve; });
      const pendingRoutes = new Set();
      const holdConnection = route => {
        const continuation = handshake.then(() => route.continue());
        pendingRoutes.add(continuation);
        return continuation.finally(() => pendingRoutes.delete(continuation));
      };
      await page.route('**/ws/info*', holdConnection);
      try {
        await page.goto('/game?mode=bot');
        await expect(page.locator('app-bot-setup')).toBeVisible();
        const connectionRequested = page.waitForRequest('**/ws/info*');
        await page.locator('.play-mode-switcher a[href="/game?mode=online"]').click();
        await connectionRequested;
        await expect(page.locator('.arena-fit-stage figure')).toBeVisible();
        await expect(page.locator('.connection-status-banner')).toHaveCount(0);
        await expect(page.locator('.arena-fit-stage .arena-caption')).toHaveCount(0);
        await expect(page.locator('.online-board-status')).toHaveCount(0);
        await expectLobbyFitsViewport(page);
        const connecting = await arenaLayout();
        releaseHandshake();
        await expect.poll(() => acknowledgements.count, { timeout: 45_000 }).toBe(1);
        await expect(page.locator('.connection-status-banner')).toHaveCount(0, { timeout: 45_000 });
        const ready = await arenaLayout();
        for (let region = 0; region < connecting.length; region += 1) {
          for (const dimension of ['x', 'y', 'width', 'height']) {
            expect(Math.abs(ready[region][dimension] - connecting[region][dimension]),
              `Arena region ${region} ${dimension} must stay fixed when connecting completes`)
              .toBeLessThanOrEqual(1);
          }
        }
      } finally {
        releaseHandshake();
        await Promise.all([...pendingRoutes]);
        await context.close();
      }
    });
  }
});

test('bot and multiplayer boards stay aligned during same-component mode switching', async ({ page }) => {
  const acknowledgements = observeOnlineAcknowledgements(page);
  await page.goto('/game?mode=bot');
  const boardLayout = () => page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return ['.board-card', '.board-shell', 'app-board .board'].map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    });
  });
  for (const [width, height] of [[1024, 768], [1280, 600], [1280, 720], [1366, 768], [1440, 900], [1536, 720], [1920, 1080], [768, 1024], [390, 844], [375, 667]]) {
    await test.step(`${width}x${height}`, async () => {
      await page.setViewportSize({ width, height });
      await expect(page.locator('app-bot-setup')).toBeVisible();
      const bot = await boardLayout();
      for (let cycle = 0; cycle < 2; cycle += 1) {
        const previousAcknowledgements = acknowledgements.count;
        await page.evaluate(() => {
          const frames = [];
          let stopped = false;
          window.stopArenaRecording = () => { stopped = true; return frames; };
          const sample = () => {
            if (stopped) return;
            const illustration = document.querySelector('.arena-fit-stage .arena-art');
            const figure = document.querySelector('.arena-fit-stage figure');
            if (illustration && figure) {
              const art = illustration.getBoundingClientRect();
              const frame = figure.getBoundingClientRect();
              frames.push({ artWidth: art.width, artHeight: art.height,
                frameWidth: frame.width, frameHeight: frame.height,
                captionCount: document.querySelectorAll('.arena-fit-stage .arena-caption').length });
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        await page.locator('.play-mode-switcher a[href="/game?mode=online"]').click();
        await expect(page.locator('app-multiplayer-lobby')).toBeVisible();
        await expect.poll(() => acknowledgements.count, { timeout: 45_000 }).toBe(previousAcknowledgements + 1);
        await expect(page.locator('app-multiplayer-lobby .connection-banner')).toHaveCount(0, { timeout: 45_000 });
        await expect(page.locator('.arena-fit-stage .arena-art')).toBeVisible();
        const arenaFrames = await page.evaluate(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return window.stopArenaRecording();
        });
        expect(arenaFrames.length).toBeGreaterThan(0);
        expect(arenaFrames.every(frame => frame.captionCount === 0)).toBe(true);
        for (const dimension of ['artWidth', 'artHeight', 'frameWidth', 'frameHeight']) {
          const values = arenaFrames.map(frame => frame[dimension]);
          expect(Math.max(...values) - Math.min(...values),
            `Arena ${dimension} must remain stable from its first rendered frame at ${width}x${height}`)
            .toBeLessThanOrEqual(1);
        }
        const online = await boardLayout();
        for (let region = 0; region < bot.length; region += 1) {
          for (const dimension of ['x', 'y', 'width', 'height']) {
            expect(Math.abs(online[region][dimension] - bot[region][dimension]),
              `Board region ${region} ${dimension} must align at ${width}x${height}`).toBeLessThanOrEqual(1);
          }
        }
        if (width > 960) await expectLobbyFitsViewport(page);
        await page.locator('.play-mode-switcher a[href="/game?mode=bot"]').click();
        await expect(page.locator('app-bot-setup')).toBeVisible();
        expect(await boardLayout()).toEqual(bot);
        if (width > 960) {
          expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
        }
      }
    });
  }
});

test('two players and a spectator complete a real multiplayer game', async ({ browser }, testInfo) => {
  const runId = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const evidenceDirectory = process.env.MULTIPLAYER_EVIDENCE_DIR;
  const hostName = evidenceDirectory ? 'Milo' : `Host${runId}`;
  const secondHostName = evidenceDirectory ? 'BlitzHost' : `Other${runId}`;
  const guestName = evidenceDirectory ? 'Alex' : `Guest${runId}`;
  const spectatorName = evidenceDirectory ? 'Sam' : `Spec${runId}`;
  const roomName = evidenceDirectory ? 'Evening Rapid' : `E2E ${runId}`;
  const secondRoomName = evidenceDirectory ? 'Friendly Blitz' : `E2E Other ${runId}`;
  const evidenceScreenshots = [];
  const captureEvidence = async (name, page) => {
    if (!evidenceDirectory) return;
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`), fullPage: true });
    evidenceScreenshots.push(`${name}.png`);
  };
  const contexts = [];
  const clients = [];
  const pageErrors = [];
  let socketSequence = 0;
  let roomCreated = false;
  let secondRoomCreated = false;
  let gameStarted = false;

  const openOnline = async (name) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    contexts.push(context);
    await context.addInitScript((username) => sessionStorage.setItem('onlineUsername', username), name);
    const page = await context.newPage();
    const networkEvents = [];
    clients.push({ name, page, networkEvents });
    page.on('pageerror', (error) => pageErrors.push(`${name}: ${error.message}`));
    page.on('websocket', (socket) => {
      const socketId = `${name}-socket-${++socketSequence}`;
      socket.on('framesent', (frame) => networkEvents.push({ socketId, direction: 'sent', ...summarizeStompFrame(frame.payload) }));
      socket.on('framereceived', (frame) => networkEvents.push({ socketId, direction: 'received', ...summarizeStompFrame(frame.payload) }));
    });
    await page.goto('/');
    await page.locator('.hero-actions').getByRole('link', { name: 'Play Online', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Create', exact: true })).toBeVisible();
    await expect.poll(
      () => networkEvents.some(event => event.direction === 'received' && event.eventType === 'helloAck'),
      { timeout: 45_000 }
    ).toBe(true);
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
    await expect(page.locator('.online-player-status strong')).toHaveText(name);
    return page;
  };

  const roomChat = (page) => page.getByRole('region', { name: 'Room chat' });

  const sendChat = async (page, message) => {
    const chat = roomChat(page);
    await chat.getByRole('textbox', { name: 'Type a message...' }).fill(message);
    await chat.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(chat.getByText(message, { exact: true })).toBeVisible();
  };

  const makeMove = async (page, from, to) => {
    const source = page.getByRole('button', { name: from, exact: true });
    await source.click();
    await expect(source).toHaveClass(/selected/);
    await page.getByRole('button', { name: to, exact: true }).click();
    await expect(page.locator(`app-board button.square.last-move[aria-label="${to}"]`)).toBeVisible();
  };

  const navigateModeInPlace = async (page, mode) => {
    await page.evaluate((nextMode) => {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', nextMode);
      const target = `${url.pathname}${url.search}${url.hash}`;
      window.history.pushState(window.history.state, '', target);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    }, mode);
    await expect(page).toHaveURL(new RegExp(`[?&]mode=${mode}(?:&|$)`));
  };

  const clockSeconds = (text) => text.trim().split(':').map(Number)
    .reduce((total, part) => total * 60 + part, 0);

  const boardBounds = async (page) => page.locator('app-board .board').evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  const expectBoardBoundsToMatch = (actual, expected) => {
    for (const dimension of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(actual[dimension] - expected[dimension]), `board ${dimension} should stay in place`)
        .toBeLessThanOrEqual(1);
    }
  };

  try {
    const host = await openOnline(hostName);
    await expect(host.locator('.lobby-tabs button.active')).toHaveCount(0);
    await expect(host.locator('.online-arena-stage app-chess-arena-animation')).toBeVisible();
    await host.getByRole('tab', { name: 'Public rooms', exact: true }).click();
    await expect(host.locator('.online-lobby-panel #online-panel-public')).toBeVisible();
    await expect(host.locator('.online-arena-stage app-chess-arena-animation')).toHaveCount(0);
    await expect(roomChat(host).getByRole('textbox')).toBeDisabled();
    await expect(roomChat(host)).toContainText('Join or create a room');
    const publicPanelBounds = await host.locator('#online-panel-public').boundingBox();
    const embeddedChatBounds = await roomChat(host).boundingBox();
    expect(Math.abs((embeddedChatBounds.y - publicPanelBounds.y) / publicPanelBounds.height - 0.5))
      .toBeLessThan(0.05);
    await host.getByRole('tab', { name: 'Public rooms', exact: true }).click();
    await expect(host.locator('.online-arena-stage app-chess-arena-animation')).toBeVisible();

    const secondHost = await openOnline(secondHostName);
    const guest = await openOnline(guestName);

    await expect(roomChat(host)).toHaveCount(0);
    await host.getByRole('tab', { name: 'Create', exact: true }).click();
    const publicRoomCheckbox = host.locator('#online-panel-create input[type="checkbox"]');
    await publicRoomCheckbox.uncheck();
    await expect(host.getByLabel('Room password')).toHaveAttribute('type', 'password');
    await publicRoomCheckbox.check();
    await host.getByLabel('Room name').fill(roomName);
    await host.getByRole('tabpanel', { name: 'Create' }).getByRole('button', {
      name: 'Create room', exact: true
    }).click();
    roomCreated = true;

    await host.getByRole('tab', { name: 'Manage', exact: true }).click();
    const hostManagement = host.locator('#online-panel-manage');
    await expect(hostManagement.getByText('Room created', { exact: true })).toBeVisible();
    const roomCode = (await hostManagement.locator('.invite-meta strong').innerText()).trim();
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    await expect(roomChat(host)).toBeVisible();
    await expectLobbyFitsViewport(host);

    await secondHost.getByRole('tab', { name: 'Create', exact: true }).click();
    await secondHost.getByLabel('Room name').fill(secondRoomName);
    await secondHost.getByRole('tabpanel', { name: 'Create' }).getByRole('button', {
      name: 'Create room', exact: true
    }).click();
    await secondHost.getByRole('tab', { name: 'Manage', exact: true }).click();
    await expect(secondHost.locator('#online-panel-manage')).toContainText('Room created');
    secondRoomCreated = true;

    await guest.getByRole('tab', { name: 'Join', exact: true }).click();
    await expect(guest.getByLabel('Join password')).toHaveAttribute('type', 'password');
    await guest.getByRole('tab', { name: 'Public rooms', exact: true }).click();
    const primaryRoomRow = guest.locator('.room-tile').filter({ hasText: roomName });
    const competingRoomRow = guest.locator('.room-tile').filter({ hasText: secondRoomName });
    await expect(primaryRoomRow).toBeVisible({ timeout: 20_000 });
    await expect(competingRoomRow).toBeVisible({ timeout: 20_000 });
    await captureEvidence('lobby-public-rooms', guest);
    expect(await guest.locator('.room-grid').evaluate(element =>
      getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBeGreaterThan(1);
    await guest.evaluate(([firstName, secondName]) => {
      const rowFor = (name) => [...document.querySelectorAll('.room-tile')]
        .find(row => row.querySelector('.room-name')?.textContent.trim() === name);
      const firstJoin = rowFor(firstName)?.querySelector('.room-actions button');
      const secondJoin = rowFor(secondName)?.querySelector('.room-actions button');
      if (!firstJoin || !secondJoin) throw new Error('Both public room join actions must exist');
      firstJoin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      secondJoin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, [roomName, secondRoomName]);
    await expect(roomChat(guest)).toBeVisible({ timeout: 20_000 });
    await expect(roomChat(guest)).toHaveCount(1);
    await expect(roomChat(guest).getByRole('textbox')).toBeEnabled({ timeout: 20_000 });
    const guestNetworkEvents = clients.find(client => client.name === guestName).networkEvents;
    await expect.poll(() => guestNetworkEvents.filter(event =>
      event.direction === 'sent' && event.command === 'SEND' && event.destination === '/app/joinRoom').length
    ).toBe(1);

    await expect(hostManagement).toContainText(guestName, { timeout: 20_000 });
    await guest.getByRole('tab', { name: 'Manage', exact: true }).click();
    await expect(guest.locator('#online-panel-manage')).toContainText(hostName);
    await expect(guest.locator('#online-panel-manage')).not.toContainText(secondHostName);
    await expect(guest.locator('#online-panel-manage')).toContainText(guestName);
    await guest.getByRole('tab', { name: 'Public rooms', exact: true }).click();
    await expect(guest.locator('.online-lobby-panel .room-chat')).toBeVisible();
    await expect(roomChat(guest)).toHaveCount(1);
    await expectLobbyFitsViewport(guest);

    const hostMessage = evidenceDirectory ? 'Ready for a rapid game?' : `hello-${runId}`;
    const guestMessage = evidenceDirectory ? 'Ready. Good luck!' : `ready-${runId}`;
    await sendChat(host, hostMessage);
    await expect(roomChat(guest).getByText(hostMessage, { exact: true })).toBeVisible();
    await sendChat(guest, guestMessage);
    await expect(roomChat(host).getByText(guestMessage, { exact: true })).toBeVisible();
    await captureEvidence('lobby-room-chat', guest);
    await captureEvidence('multiplayer-room-management', host);

    const startGame = host.getByRole('button', { name: 'Start game', exact: true });
    await expect(startGame).toBeEnabled({ timeout: 20_000 });
    await startGame.click();
    gameStarted = true;
    await expect(host.locator('.online-actions-card')).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator('.online-actions-card')).toBeVisible({ timeout: 20_000 });
    await expect(host.locator('.online-actions-card .connection-banner').filter({ hasText: /^\s*$/ })).toHaveCount(0);

    const hostColorText = (await host.locator('.online-actions-card .card-subtitle').innerText()).toUpperCase();
    const guestColorText = (await guest.locator('.online-actions-card .card-subtitle').innerText()).toUpperCase();
    const hostColor = hostColorText.includes('WHITE') ? 'WHITE' : 'BLACK';
    const guestColor = guestColorText.includes('WHITE') ? 'WHITE' : 'BLACK';
    expect(hostColor).not.toBe(guestColor);
    expect(hostColorText).toMatch(/WHITE|BLACK/);
    expect(guestColorText).toMatch(/WHITE|BLACK/);
    const white = hostColor === 'WHITE' ? host : guest;
    const black = hostColor === 'BLACK' ? host : guest;

    await expect(host.getByRole('button', { name: 'e2', exact: true }).locator('img')).toBeVisible();
    await expect(guest.getByRole('button', { name: 'e2', exact: true }).locator('img')).toBeVisible();
    await makeMove(white, 'e2', 'e4');
    for (const page of [host, guest]) {
      await expect(page.locator('app-board button.square.last-move[aria-label="e4"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'e4', exact: true }).locator('img')).toBeVisible();
      await expect(page.getByRole('button', { name: 'e2', exact: true }).locator('img')).toHaveCount(0);
    }

    // A white client must not move while Black owns the turn.
    await white.getByRole('button', { name: 'd2', exact: true }).click();
    await white.getByRole('button', { name: 'd4', exact: true }).click();
    await expect(white.locator('app-board button.square.last-move[aria-label="e4"]')).toBeVisible();
    await expect(white.getByRole('button', { name: 'd4', exact: true }).locator('img')).toHaveCount(0);

    await makeMove(black, 'e7', 'e5');
    for (const page of [host, guest]) {
      await expect(page.locator('app-board button.square.last-move[aria-label="e5"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'e5', exact: true }).locator('img')).toBeVisible();
      await expect(page.getByRole('button', { name: 'e7', exact: true }).locator('img')).toHaveCount(0);
    }
    const onlineBoardBeforeModeSwitch = await boardBounds(host);

    const hostNetworkEvents = clients.find(client => client.name === hostName).networkEvents;
    const hostGameSubscriptions = () => hostNetworkEvents.filter(event =>
      event.direction === 'sent' && event.command === 'SUBSCRIBE'
        && typeof event.destination === 'string' && event.destination.startsWith('/topic/game/')
    );
    await expect.poll(() => hostGameSubscriptions().length).toBe(1);
    const gameTopic = hostGameSubscriptions()[0].destination;
    const gameShell = host.locator('.game-shell');
    await gameShell.evaluate(element => element.setAttribute('data-e2e-component-instance', 'preserved'));
    const playerAndClockState = {
      subtitle: await host.locator('.online-actions-card .card-subtitle').innerText(),
      turn: await host.locator('.multiplayer-turn-status').innerText(),
      clocks: await host.locator('.online-actions-card .player-clock').allInnerTexts()
    };
    expect(playerAndClockState.clocks).toHaveLength(2);
    expect(playerAndClockState.clocks.every(value => Number.isFinite(clockSeconds(value)))).toBe(true);

    // Change only the query parameter so Angular reuses the same GamePageComponent instance.
    await navigateModeInPlace(host, 'bot');
    await expect(gameShell).toHaveAttribute('data-e2e-component-instance', 'preserved');
    const botSetup = host.locator('app-bot-setup');
    await expect(botSetup).toBeVisible();
    await botSetup.getByRole('button', { name: 'Black', exact: true }).click();
    await botSetup.getByRole('button', { name: 'Start Game', exact: true }).click();
    await expect(botSetup).toHaveCount(0);
    await expect(host.locator('.bot-actions-card')).toBeVisible();
    const botBoardAfterModeSwitch = await boardBounds(host);
    expectBoardBoundsToMatch(botBoardAfterModeSwitch, onlineBoardBeforeModeSwitch);

    await navigateModeInPlace(host, 'online');
    await expect(gameShell).toHaveAttribute('data-e2e-component-instance', 'preserved');
    await expect(host.locator('.online-actions-card')).toBeVisible({ timeout: 45_000 });
    await expect(host.locator('.multiplayer-turn-status')).toHaveText(playerAndClockState.turn, { timeout: 45_000 });
    await expect(host.locator('.online-actions-card .card-subtitle')).toHaveText(playerAndClockState.subtitle);
    await expect(host.locator('app-board button.square.last-move[aria-label="e5"]')).toBeVisible();
    await expect(host.locator('app-board button.square.last-move[aria-label="e7"]')).toBeVisible();
    await expect(host.getByRole('button', { name: 'e4', exact: true }).locator('img')).toBeVisible();
    await expect(host.getByRole('button', { name: 'e5', exact: true }).locator('img')).toBeVisible();
    await expect(host.getByRole('button', { name: 'e2', exact: true }).locator('img')).toHaveCount(0);
    await expect(host.getByRole('button', { name: 'e7', exact: true }).locator('img')).toHaveCount(0);
    expectBoardBoundsToMatch(await boardBounds(host), onlineBoardBeforeModeSwitch);
    const recoveredClocks = await host.locator('.online-actions-card .player-clock').allInnerTexts();
    expect(clockSeconds(recoveredClocks[0])).toBeLessThanOrEqual(clockSeconds(playerAndClockState.clocks[0]));
    expect(clockSeconds(recoveredClocks[1])).toBe(clockSeconds(playerAndClockState.clocks[1]));

    // Repeated same-component switches must reconnect once and subscribe once per socket.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await navigateModeInPlace(host, 'bot');
      await expect(host.locator('app-bot-setup')).toBeVisible();
      await navigateModeInPlace(host, 'online');
      await expect(host.locator('.multiplayer-turn-status')).toHaveText(playerAndClockState.turn, { timeout: 45_000 });
      await expect(host.locator('app-board button.square.last-move[aria-label="e5"]')).toBeVisible();
      await expect.poll(() => hostGameSubscriptions().length).toBe(cycle + 3);
    }
    await expect.poll(() => hostNetworkEvents.filter(event =>
      event.direction === 'received' && event.eventType === 'helloAck'
    ).length).toBe(4);
    const hostSocketIds = [...new Set(hostNetworkEvents
      .filter(event => event.command === 'CONNECT')
      .map(event => event.socketId))];
    expect(hostSocketIds).toHaveLength(4);
    for (const socketId of hostSocketIds) {
      const events = hostNetworkEvents.filter(event => event.socketId === socketId);
      const subscriptions = events.filter(event => event.direction === 'sent' && event.command === 'SUBSCRIBE')
        .map(event => event.destination);
      expect(subscriptions.length).toBe(new Set(subscriptions).size);
      expect(events.filter(event => event.direction === 'sent' && event.command === 'CONNECT')).toHaveLength(1);
      expect(events.filter(event => event.direction === 'received' && event.command === 'CONNECTED')).toHaveLength(1);
      expect(events.filter(event => event.direction === 'received' && event.eventType === 'helloAck')).toHaveLength(1);
    }
    expect(hostGameSubscriptions().map(event => event.destination)).toEqual([gameTopic, gameTopic, gameTopic, gameTopic]);

    await guest.reload();
    await expect(guest.locator('.online-actions-card')).toBeVisible({ timeout: 45_000 });
    await expect(guest.locator('.multiplayer-turn-status')).toContainText('Game in progress', { timeout: 45_000 });
    await expect(guest.locator('app-board button.square.last-move[aria-label="e5"]')).toBeVisible();

    await captureEvidence('multiplayer-live-game', host);
    const spectator = await openOnline(spectatorName);
    await spectator.getByRole('tab', { name: 'Public rooms', exact: true }).click();
    const roomRow = spectator.locator('.room-tile').filter({ hasText: roomName });
    await expect(roomRow).toContainText('Game in progress', { timeout: 20_000 });
    await roomRow.getByRole('button', { name: 'Spectate', exact: true }).click();
    await expect(spectator.locator('.online-actions-card')).toContainText('Spectator', {
      timeout: 20_000
    });
    await spectator.getByRole('button', { name: 'd2', exact: true }).click();
    await spectator.getByRole('button', { name: 'd4', exact: true }).click();
    await expect(spectator.locator('app-board button.square.last-move[aria-label="e5"]')).toBeVisible();
    await expect(spectator.getByRole('button', { name: 'd4', exact: true }).locator('img')).toHaveCount(0);
    await expect(spectator.locator('.online-actions-card').getByRole('button', { name: 'Resign', exact: true })).toHaveCount(0);
    await expect(spectator.locator('.online-actions-card').getByRole('button', { name: 'Offer draw', exact: true })).toHaveCount(0);
    await expect(spectator.locator('.online-actions-card .connection-banner').filter({ hasText: /^\s*$/ })).toHaveCount(0);
    await captureEvidence('multiplayer-spectator', spectator);

    await host.locator('.online-actions-card').getByRole('button', { name: 'Resign', exact: true }).click();
    await expect(guest.locator('.multiplayer-turn-status')).toHaveText(/Game finished/, {
      timeout: 20_000
    });
    await expect(guest.getByRole('button', { name: 'Review Game', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Review Game', exact: true }).click();
    await expect(guest.locator('#multiplayer-review-history')).toBeVisible();
    await expect(guest.locator('#multiplayer-review-history')).toContainText('e4');
    await expect(guest.locator('#multiplayer-review-history')).toContainText('e5');
    const replay = guest.locator('#multiplayer-review-history app-move-history');
    await expect(replay.getByRole('button', { name: 'Last', exact: true })).toBeDisabled();
    await replay.getByRole('button', { name: 'First', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'e2', exact: true }).locator('img')).toBeVisible();
    await expect(guest.getByRole('button', { name: 'e4', exact: true }).locator('img')).toHaveCount(0);
    await replay.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'e4', exact: true }).locator('img')).toBeVisible();
    await expect(replay.locator('.move-cell.active')).toHaveText('e4');
    await replay.getByRole('button', { name: 'Last', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'e5', exact: true }).locator('img')).toBeVisible();
    await expect(replay.locator('.move-cell.active')).toHaveText('e5');
    await expect(replay.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await spectator.getByRole('button', { name: 'Review Game', exact: true }).click();
    await expect(spectator.locator('#multiplayer-review-history')).toBeVisible();
    await expect(spectator.locator('#multiplayer-review-history app-move-history'))
      .toContainText('2 / 2');
    expect(pageErrors).toEqual([]);
    if (evidenceDirectory) {
      await writeFile(resolve(evidenceDirectory, 'multiplayer-report.json'), JSON.stringify({
        timestamp: new Date().toISOString(), runId,
        baseUrl: testInfo.project.use.baseURL,
        browser: `Chromium ${browser.version()}`,
        roomCode, roomName, hostName, guestName, spectatorName,
        checks: [
          'room creation and management', 'competing room joins remain serialized',
          'room chat works in the public-room panel', 'legal moves synchronize',
          'same-component mode switching and refresh restore the game',
          'spectator remains read-only', 'resignation and finished-game replay'
        ],
        screenshots: evidenceScreenshots, runtimeErrors: pageErrors
      }, null, 2) + '\n');
    }

    await testInfo.attach('multiplayer-smoke-summary', {
      body: Buffer.from(JSON.stringify({
        runId,
        roomName,
        checks: [
          'chat absent before membership', 'host create and manage room', 'guest join and participant sync',
          'overlapping public-room join attempts publish one request and preserve authoritative membership',
          'bidirectional room chat', 'opposite player colors', 'e2-e4 and e7-e5 synchronized on both clients',
          'Online to Bot to Online restores the active game; browser refresh restores the same game position',
          'wrong-turn move rejected', 'spectator remains read-only', 'resignation reaches both clients',
          'finished game review replays board positions with navigation for a player and spectator'
        ],
        pageErrors
      }, null, 2)),
      contentType: 'application/json'
    });
  } catch (error) {
    const diagnostics = [];
    for (const client of clients) {
      if (client.page.isClosed()) continue;
      const setupText = await client.page.locator('.online-controls').innerText().catch(() => 'Online setup unavailable');
      const visibleErrors = await client.page.locator('.online-controls .error').allInnerTexts().catch(() => []);
      diagnostics.push({ name: client.name, setupText, visibleErrors, networkEvents: client.networkEvents });
      await client.page.screenshot({ path: testInfo.outputPath(`${client.name}-failure.png`), fullPage: true })
        .catch(() => {});
    }
    console.error('Multiplayer browser diagnostics:', JSON.stringify(diagnostics));
    await testInfo.attach('multiplayer-ui-diagnostics', {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
      contentType: 'application/json'
    });
    throw error;
  } finally {
    const host = clients.find(client => client.name === hostName)?.page;
    const secondHost = clients.find(client => client.name === secondHostName)?.page;
    const guest = clients.find(client => client.name === guestName)?.page;
    const spectator = clients.find(client => client.name === spectatorName)?.page;
    if (host && !host.isClosed()) {
      if (gameStarted) {
        await host.locator('.online-actions-card').getByRole('button', { name: 'Resign', exact: true })
          .click({ timeout: 2_000 }).catch(() => {});
      } else if (roomCreated) {
        await host.getByRole('tab', { name: 'Manage', exact: true }).click({ timeout: 2_000 }).catch(() => {});
        await host.getByRole('button', { name: 'Delete room', exact: true })
          .click({ timeout: 2_000 }).catch(() => {});
      }
    }
    if (gameStarted && host && !host.isClosed()) {
      await expect(host.locator('.multiplayer-turn-status')).toHaveText(/Game finished/, { timeout: 5_000 })
        .catch(() => {});
    }
    for (const page of [spectator, guest]) {
      if (!page || page.isClosed()) continue;
      await page.getByRole('tab', { name: 'Manage', exact: true }).click({ timeout: 2_000 }).catch(() => {});
      await page.getByRole('button', { name: 'Leave room', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    }
    if (gameStarted && host && !host.isClosed()) {
      await host.getByRole('button', { name: 'Back to lobby', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    }
    if (secondRoomCreated && secondHost && !secondHost.isClosed()) {
      await secondHost.getByRole('tab', { name: 'Manage', exact: true }).click({ timeout: 2_000 }).catch(() => {});
      await secondHost.getByRole('button', { name: 'Delete room', exact: true })
        .click({ timeout: 2_000 }).catch(() => {});
    }

    for (let index = 0; index < contexts.length; index += 1) {
      const context = contexts[index];
      await context.close().catch(() => {});
    }
  }
});
