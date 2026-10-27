// Real-browser multiplayer smoke review using two isolated Chrome profiles and the local backend.
// No server state is faked; all room and move events travel through the configured SockJS/STOMP endpoint.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = resolve(root, '../docs/arena-evidence');
const baseUrl = process.env.MULTIPLAYER_BASE_URL || 'http://localhost:4200';
const chromePath = process.env.ARENA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(evidence, { recursive: true });

async function launch(name) {
  const profile = resolve(root, 'tmp', `multiplayer-${name}-${process.pid}`);
  await mkdir(profile, { recursive: true });
  const processHandle = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let socket;
  let send;
  let closed = false;
  const cleanup = async () => {
    if (socket?.readyState === 1 && !closed && send) {
      closed = true;
      await send('Browser.close').catch(() => {});
    }
    socket?.close();
    if (processHandle.exitCode === null) processHandle.kill();
  };

  try {
    let port;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
      catch { await sleep(100); }
    }
    assert.ok(port, `Chrome ${name} did not expose a DevTools port`);
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    const runtimeErrors = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    };
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const until = async (expression, timeoutMs = 30000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await sleep(100);
      }
      throw new Error(`Browser ${name} condition timed out: ${expression}`);
    };
    const clickText = async (selector, text) => evaluate(`{
      const element=[...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(node=>node.textContent.trim()===${JSON.stringify(text)});
      if(!element) throw new Error('Missing ${text} in ${selector}');
      element.click(); true
    }`);
    const screenshot = async filename => {
      const { cssContentSize } = await send('Page.getLayoutMetrics');
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
      await writeFile(resolve(evidence, filename), Buffer.from(data, 'base64'));
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    return { name, send, evaluate, until, clickText, screenshot, runtimeErrors, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function openOnline(client, username) {
  await client.send('Page.navigate', { url: baseUrl });
  await client.until(`location.pathname === '/' && !!document.querySelector('app-home-page') && !!window.ng`);
  await client.evaluate(`sessionStorage.setItem('onlineUsername', ${JSON.stringify(username)}); true`);
  await client.clickText('.hero-actions a', 'Play Online');
  await client.until(`location.pathname === '/game' && new URLSearchParams(location.search).get('mode') === 'online' &&
    !!window.ng?.getComponent(document.querySelector('app-game-page'))`);
  await client.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.connectionState$.value === 'READY'`, 45000);
  await client.evaluate(`{
    const service=ng.getComponent(document.querySelector('app-game-page')).multiplayer;
    service.__reviewEvents=[];
    const handle=service.handleMessage.bind(service);
    service.handleMessage=(message)=>{
      try {
        const event=JSON.parse(message.body), payload=event.payload||{};
        service.__reviewEvents.push({type:event.type, gameId:payload.gameId||payload.state?.gameId||null,
          moves:payload.moves?.length??payload.state?.moves?.length??null,
          reason:payload.reason??(typeof payload==='string'?payload:null), move:payload.move??null,
          fen:payload.fen??payload.state?.fen??null, sideToMove:payload.sideToMove??payload.state?.sideToMove??null,
          result:payload.result??payload.state?.result??null, endReason:payload.endReason??payload.state?.endReason??null,
          version:payload.version??payload.state?.version??null,
          whiteTimeLeftMs:payload.whiteTimeLeftMs??payload.state?.whiteTimeLeftMs??null,
          blackTimeLeftMs:payload.blackTimeLeftMs??payload.state?.blackTimeLeftMs??null,
          lastMoveAt:payload.lastMoveAt??payload.state?.lastMoveAt??null});
      } catch {}
      return handle(message);
    };
    true
  }`);
  const actualName = await client.evaluate(`ng.getComponent(document.querySelector('app-game-page')).sessionUsername`);
  assert.equal(actualName, username, `Server should identify browser ${client.name} by its requested name`);
}

async function clickSquare(client, square) {
  const label = await client.evaluate(`ng.getComponent(document.querySelector('app-board')).squareLabel(${JSON.stringify(square)})`);
  await client.evaluate(`{
    const button=[...document.querySelectorAll('app-board button.square')]
      .find(candidate=>candidate.getAttribute('aria-label')===${JSON.stringify(label)});
    if(!button) throw new Error('No rendered square ${square}');
    button.click(); true
  }`);
}

const runId = Date.now().toString(36).toUpperCase();
const hostName = `Host${runId}`;
const guestName = `Guest${runId}`;
const host = await launch('host');
const guest = await launch('guest');
let spectator;
const result = { runId, baseUrl, checks: {}, roomCode: null, gameId: null, runtimeErrors: [] };

try {
  await openOnline(host, hostName);
  await host.clickText('#online-tab-create', 'Create');
  await host.until('!!document.querySelector("#online-panel-create")');
  await host.clickText('#online-panel-create button', 'Create room');
  await host.until(`!!ng.getComponent(document.querySelector('app-game-page')).multiplayer.roomCode$.value`, 20000);
  const disposableCode = await host.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.roomCode$.value`);
  await host.clickText('#online-tab-manage', 'Manage');
  await host.until(`ng.getComponent(document.querySelector('app-game-page')).isHostInRoom() &&
    !!document.querySelector('#online-panel-manage .invite-title')`);
  assert.ok(await host.evaluate(`!![...document.querySelectorAll('#online-panel-manage button')]
    .find(button=>button.textContent.trim()==='Delete room')`), 'Room owner should have a delete action');
  result.checks.createRoomAppearsInManagement = true;
  result.checks.hostCanDeleteRoom = true;
  await host.screenshot('multiplayer-room-management.png');
  await host.clickText('#online-panel-manage button', 'Delete room');
  await host.until(`!ng.getComponent(document.querySelector('app-game-page')).multiplayer.activeRoomCode$.value &&
    !ng.getComponent(document.querySelector('app-game-page')).multiplayer.roomCode$.value`);
  await host.until(`!!document.querySelector('#online-panel-manage .invite-title') &&
    document.querySelector('#online-panel-manage .invite-title').textContent.includes('No active room')`);
  result.checks.deleteClearsManagementState = true;

  await host.clickText('#online-tab-create', 'Create');
  await host.until('!!document.querySelector("#online-panel-create")');
  await host.clickText('#online-panel-create button', 'Create room');
  await host.until(`!!ng.getComponent(document.querySelector('app-game-page')).multiplayer.roomCode$.value &&
    ng.getComponent(document.querySelector('app-game-page')).multiplayer.roomCode$.value !== ${JSON.stringify(disposableCode)}`, 20000);
  const roomCode = await host.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.roomCode$.value`);
  result.roomCode = roomCode;
  await host.clickText('#online-tab-manage', 'Manage');
  await host.until(`ng.getComponent(document.querySelector('app-game-page')).isHostInRoom()`);

  await openOnline(guest, guestName);
  await guest.clickText('#online-tab-join', 'Join');
  await guest.until('!!document.querySelector("#online-panel-join")');
  await guest.evaluate(`{
    const input=document.querySelector('#online-panel-join input');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(input, ${JSON.stringify(roomCode)});
    input.dispatchEvent(new Event('input',{bubbles:true})); true
  }`);
  await guest.clickText('#online-panel-join button', 'Join room');
  await guest.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.lastError$.value ||
    (ng.getComponent(document.querySelector('app-game-page')).multiplayer.activeRoomCode$.value === ${JSON.stringify(roomCode)} &&
    ng.getComponent(document.querySelector('app-game-page')).multiplayer.roomParticipants$.value.some(participant=>participant.role==='PLAYER'))`, 20000);
  const guestJoinError = await guest.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.lastError$.value`);
  assert.equal(guestJoinError, null, `Guest join should succeed; server returned ${guestJoinError}`);
  await host.until(`ng.getComponent(document.querySelector('app-game-page')).hasPendingPlayer()`, 20000);
  await host.clickText('#online-tab-manage', 'Manage');
  await host.until(`!![...document.querySelectorAll('#online-panel-manage button')]
    .find(button=>button.textContent.trim()==='Start game' && !button.disabled)`);
  result.checks.secondClientJoinsRoom = true;
  result.checks.hostCanStartWhenOpponentJoins = true;
  await host.clickText('#online-panel-manage button', 'Start game');
  await host.until(`!!ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.gameId`, 20000);
  await guest.until(`!!ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.gameId`, 20000);
  const hostGame = await host.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value`);
  const guestGame = await guest.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value`);
  assert.equal(hostGame.gameId, guestGame.gameId, 'Both browsers must receive the same authoritative game');
  assert.equal(hostGame.fen, guestGame.fen, 'Both browsers must start from the same authoritative position');
  result.gameId = hostGame.gameId;
  result.checks.bothClientsReceiveSameGame = true;
  const hostColor = await host.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.yourColor$.value`);
  const guestColor = await guest.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.yourColor$.value`);
  assert.notEqual(hostColor, guestColor, 'Players must receive opposite colors');
  assert.ok(['WHITE', 'BLACK'].includes(hostColor) && ['WHITE', 'BLACK'].includes(guestColor));
  result.checks.playersReceiveOppositeColors = true;
  const white = hostColor === 'WHITE' ? host : guest;
  const black = hostColor === 'BLACK' ? host : guest;
  assert.equal(await white.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.yourColor$.value`), 'WHITE');
  assert.equal(await black.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.yourColor$.value`), 'BLACK');
  assert.equal(await white.evaluate(`ng.getComponent(document.querySelector('app-game-page')).canHumanMove()`), true,
    'White should be allowed to make the first move');
  await Promise.all([host, guest].map(client => client.evaluate(`
    ng.getComponent(document.querySelector('app-game-page')).multiplayer.clearLastError(); true`)));

  await clickSquare(white, 'e2');
  await white.until(`ng.getComponent(document.querySelector('app-game-page')).state.selectedSquare$.value === 'e2'`, 5000);
  await clickSquare(white, 'e4');
  await white.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.moves.length === 1 ||
    ng.getComponent(document.querySelector('app-game-page')).multiplayer.lastError$.value`, 15000);
  const moveError = await white.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.lastError$.value`);
  if (moveError) {
    const diagnostic = await Promise.all([host, guest].map(client => client.evaluate(`{
      const p=ng.getComponent(document.querySelector('app-game-page'));
      const service=p.multiplayer, event=service.__reviewEvents.find(item=>item.type==='moveAccepted');
      const current=service.gameState$.value;
      const candidate=event&&current?{...current,fen:event.fen,sideToMove:event.sideToMove,
        whiteTimeLeftMs:event.whiteTimeLeftMs,blackTimeLeftMs:event.blackTimeLeftMs,
        lastMoveAt:event.lastMoveAt,moves:[...current.moves,event.move],version:event.version}:null;
      ({ game:p.multiplayer.gameState$.value, error:p.multiplayer.lastError$.value,
         selected:p.state.selectedSquare$.value, pending:p.pendingServerMove,
         ready:p.multiplayer.connectionState$.value, color:p.multiplayer.yourColor$.value,
         candidateValid:candidate?service.isValidGameSnapshot(candidate,true):null,
         candidateDecision:candidate?service.reconcileGameUpdate(current,candidate,'MOVE_ACCEPTED',event):null,
         events:p.multiplayer.__reviewEvents })
    }`)));
    console.error('Multiplayer state after first move:', JSON.stringify(diagnostic));
  }
  assert.equal(moveError, null, `Server should accept the white move; returned ${moveError}`);
  await guest.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.moves.length === 1 ||
    ng.getComponent(document.querySelector('app-game-page')).multiplayer.lastError$.value`, 15000);
  const guestMoveError = await guest.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.lastError$.value`);
  assert.equal(guestMoveError, null, `Opponent should receive the white move; returned ${guestMoveError}`);
  const afterWhiteMove = await Promise.all([
    host.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value`),
    guest.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value`)
  ]);
  assert.equal(afterWhiteMove[0].fen, afterWhiteMove[1].fen);
  assert.equal(afterWhiteMove[0].version, afterWhiteMove[1].version);
  assert.equal(await white.evaluate(`ng.getComponent(document.querySelector('app-game-page')).canHumanMove()`), false,
    'The player who moved must not be allowed another move');
  assert.equal(await black.evaluate(`ng.getComponent(document.querySelector('app-game-page')).canHumanMove()`), true,
    'The assigned opponent must be allowed to move');
  result.checks.legalMoveSynchronizesToBothClients = true;
  result.checks.opponentTurnOwnershipIsEnforced = true;
  await clickSquare(black, 'e7');
  await clickSquare(black, 'e5');
  await host.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.moves.length === 2`, 15000);
  const afterBlackMove = await host.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value`);
  assert.equal(afterBlackMove.fen,
    await guest.evaluate(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value.fen`));
  result.checks.secondLegalMoveSynchronizes = true;
  await host.screenshot('multiplayer-live-game.png');

  spectator = await launch('spectator');
  const spectatorName = `Spec${runId}`;
  await openOnline(spectator, spectatorName);
  await spectator.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.publicRooms$.value
    .some(room=>room.roomCode===${JSON.stringify(roomCode)} && room.status==='IN_GAME')`, 20000);
  await spectator.evaluate(`{
    const row=[...document.querySelectorAll('.room-row')]
      .find(candidate=>candidate.textContent.includes(${JSON.stringify(roomCode)}));
    const button=[...(row?.querySelectorAll('button')||[])]
      .find(candidate=>candidate.textContent.trim()==='Spectate');
    if(!button) throw new Error('The target in-game room has no Spectate action');
    button.click(); true
  }`);
  await spectator.until(`ng.getComponent(document.querySelector('app-game-page')).isSpectator() &&
    ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.gameId === ${JSON.stringify(hostGame.gameId)}`, 20000);
  assert.equal(await spectator.evaluate(`ng.getComponent(document.querySelector('app-game-page')).canHumanMove()`), false);
  await clickSquare(spectator, 'd2');
  assert.equal(await spectator.evaluate(`ng.getComponent(document.querySelector('app-game-page')).state.selectedSquare$.value`), null);
  result.checks.spectatorIsReadOnly = true;
  await spectator.screenshot('multiplayer-spectator.png');

  for (const client of [host, guest, spectator]) {
    result.runtimeErrors.push(...client.runtimeErrors.map(error => `${client.name}: ${error}`));
  }
  await host.clickText('.online-actions-card button', 'Resign');
  await host.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.result !== 'ONGOING'`, 15000);
  await guest.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.result !== 'ONGOING'`, 15000);
  result.checks.finishedGameClosesRoom = true;
  assert.deepEqual(result.runtimeErrors, [], 'Browser runtime should not throw during real multiplayer flow');
  await writeFile(resolve(evidence, 'multiplayer-report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Multiplayer smoke passed:', JSON.stringify(result));
} finally {
  if (host) {
    await host.evaluate(`{
      const p=ng.getComponent(document.querySelector('app-game-page'));
      const game=p.multiplayer.gameState$.value;
      if(game?.result==='ONGOING' && p.isHostInRoom()) p.multiplayer.resign(game.gameId);
      else if(p.isHostInRoom() && p.multiplayer.roomCode$.value) p.multiplayer.deleteRoom(p.multiplayer.roomCode$.value);
      true
    }`).catch(() => {});
    await host.until(`ng.getComponent(document.querySelector('app-game-page')).multiplayer.gameState$.value?.result !== 'ONGOING'`, 5000).catch(() => {});
    await host.evaluate(`{const p=ng.getComponent(document.querySelector('app-game-page'));p.multiplayer.disconnect();ng.applyChanges(p);true}`).catch(() => {});
  }
  for (const client of [guest, spectator]) {
    if (!client) continue;
    await client.evaluate(`{const p=ng.getComponent(document.querySelector('app-game-page'));p.multiplayer.leaveRoom();p.multiplayer.disconnect();ng.applyChanges(p);true}`).catch(() => {});
  }
  if (spectator) await spectator.cleanup();
  await guest.cleanup();
  await host.cleanup();
}
