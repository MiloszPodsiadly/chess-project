import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const summarizeStompFrame = (payload) => {
  if (typeof payload !== 'string') return {};
  const framed = payload.startsWith('a') ? payload.slice(1) : payload;
  let messages;
  try { messages = JSON.parse(framed); } catch { messages = [framed]; }
  const frame = Array.isArray(messages) ? messages.find((message) => typeof message === 'string') : null;
  if (!frame) return {};
  const command = frame.split('\n', 1)[0];
  if (command !== 'MESSAGE') return { command };
  const separator = frame.indexOf('\n\n');
  if (separator < 0) return { command };
  try {
    const body = JSON.parse(frame.slice(separator + 2).replace(/\0+$/, ''));
    return { command, eventType: typeof body.type === 'string' ? body.type : 'unknown' };
  } catch {
    return { command, eventType: 'unparseable' };
  }
};

test('two players and a spectator complete a real multiplayer game', async ({ browser }, testInfo) => {
  const runId = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const hostName = `Host${runId}`;
  const guestName = `Guest${runId}`;
  const spectatorName = `Spec${runId}`;
  const roomName = `E2E ${runId}`;
  const contexts = [];
  const clients = [];
  const pageErrors = [];
  let roomCreated = false;
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
      socket.on('framesent', (frame) => networkEvents.push({ direction: 'sent', ...summarizeStompFrame(frame.payload) }));
      socket.on('framereceived', (frame) => networkEvents.push({ direction: 'received', ...summarizeStompFrame(frame.payload) }));
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

  try {
    const host = await openOnline(hostName);
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

    await guest.getByRole('tab', { name: 'Join', exact: true }).click();
    await expect(guest.getByLabel('Join password')).toHaveAttribute('type', 'password');
    await guest.getByLabel('Room code').fill(roomCode);
    await guest.getByRole('tabpanel', { name: 'Join' }).getByRole('button', {
      name: 'Join room', exact: true
    }).click();
    await expect(roomChat(guest)).toBeVisible({ timeout: 20_000 });

    await expect(hostManagement).toContainText(guestName, { timeout: 20_000 });
    await guest.getByRole('tab', { name: 'Manage', exact: true }).click();
    await expect(guest.locator('#online-panel-manage')).toContainText(hostName);
    await expect(guest.locator('#online-panel-manage')).toContainText(guestName);

    const hostMessage = `hello-${runId}`;
    const guestMessage = `ready-${runId}`;
    await sendChat(host, hostMessage);
    await expect(roomChat(guest).getByText(hostMessage, { exact: true })).toBeVisible();
    await sendChat(guest, guestMessage);
    await expect(roomChat(host).getByText(guestMessage, { exact: true })).toBeVisible();

    const startGame = host.getByRole('button', { name: 'Start game', exact: true });
    await expect(startGame).toBeEnabled({ timeout: 20_000 });
    await startGame.click();
    gameStarted = true;
    await expect(host.locator('.online-actions-card')).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator('.online-actions-card')).toBeVisible({ timeout: 20_000 });

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

    const spectator = await openOnline(spectatorName);
    await spectator.getByRole('tab', { name: 'Public rooms', exact: true }).click();
    const roomRow = spectator.locator('.room-row').filter({ hasText: roomName });
    await expect(roomRow).toContainText('IN_GAME', { timeout: 20_000 });
    await roomRow.getByRole('button', { name: 'Spectate', exact: true }).click();
    await expect(spectator.locator('.online-actions-card')).toContainText('Spectator', {
      timeout: 20_000
    });
    await spectator.getByRole('button', { name: 'd2', exact: true }).click();
    await spectator.getByRole('button', { name: 'd4', exact: true }).click();
    await expect(spectator.locator('app-board button.square.last-move[aria-label="e5"]')).toBeVisible();
    await expect(spectator.getByRole('button', { name: 'd4', exact: true }).locator('img')).toHaveCount(0);

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

    await testInfo.attach('multiplayer-smoke-summary', {
      body: Buffer.from(JSON.stringify({
        runId,
        roomName,
        checks: [
          'chat absent before membership', 'host create and manage room', 'guest join and participant sync',
          'bidirectional room chat', 'opposite player colors', 'e2-e4 and e7-e5 synchronized on both clients',
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
    const [host, guest, spectator] = clients.map((client) => client.page);
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

    for (let index = 0; index < contexts.length; index += 1) {
      const context = contexts[index];
      await context.close().catch(() => {});
    }
  }
});
