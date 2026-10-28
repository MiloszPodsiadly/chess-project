// Local evidence runner. Requires a dev server for Angular state fixtures and a production build.
// Playwright supplies a cross-platform Chromium binary; production performance is measured on the built bundle.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = resolve(root, '../docs/arena-evidence');
const devUrl = process.env.ARENA_DEV_URL || 'http://localhost:4200';
const dist = resolve(root, 'dist/chess-web/browser');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const responsiveViewports = [[375,667],[390,844],[768,1024],[1024,768],[1280,720],[1366,768],[1440,900],[1920,1080]];
await mkdir(evidence, { recursive: true });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
    if (path !== dist && !path.startsWith(dist + sep)) throw new Error('path');
    try { if (!(await stat(path)).isFile()) path = resolve(dist, 'index.html'); }
    catch { path = resolve(dist, 'index.html'); }
    res.setHeader('Content-Type', mime[extname(path)] || 'text/html');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const prodUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const send = (method, params = {}) => cdp.send(method, params);
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
cdp.on('Runtime.exceptionThrown', event => runtimeErrors.push(event.exceptionDetails.text));
let browserClosed = false;
try {
  const evaluate = expression => page.evaluate(expression);
  const until = async expression => {
    for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Browser condition timed out: ${expression}`);
  };
  const viewport = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width < 600 ? 2 : 1, mobile: width < 600 });
  };
  const load = async url => {
    await send('Page.navigate', { url });
    await sleep(100);
    await until(`location.href === ${JSON.stringify(url + (url === devUrl || url === prodUrl ? '/' : ''))} && !!document.querySelector('app-chess-arena-animation svg')`);
  };
  const settle = () => evaluate(`document.querySelector('app-chess-arena-animation')?.getAnimations({subtree:true}).forEach(a=>{if(a.effect.getTiming().iterations!==Infinity)a.finish()}); true`);
  const screenshot = async name => {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
    await writeFile(resolve(evidence, name + '.png'), Buffer.from(data, 'base64'));
  };
  const report = { timestamp: new Date().toISOString(), browser: { product: `Chromium ${browser.version()}` },
    environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramGiB: +(totalmem() / 2 ** 30).toFixed(1), platform: platform(), mode: 'headless Chrome; mobile uses emulation with 4x CPU slowdown' },
    screenshots: [], benchmarks: [], checks: {} };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Performance.enable');
  await viewport(1440, 900);
  await load(prodUrl);
  await evaluate(`document.querySelector('app-chess-arena-animation').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=0});true`);
  await screenshot('intro-timeline-zero');
  await evaluate(`document.querySelector('app-chess-arena-animation').getAnimations({subtree:true}).forEach(a=>a.play());true`);
  await sleep(3800);
  await screenshot('arena-revealed');
  for (const [width, height] of responsiveViewports) {
    await viewport(width, height);
    await settle();
    await sleep(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, `Horizontal overflow at ${width}`);
    const actionLayout = await evaluate(`(() => {
      const buttons=[...document.querySelectorAll('.hero-actions .arena-button')];
      const rects=buttons.map(button=>button.getBoundingClientRect());
      const hero=document.querySelector('.hero-text').getBoundingClientRect();
      const actions=document.querySelector('.hero-actions').getBoundingClientRect();
      const labelCenters=buttons.map(button=>{
        const rect=button.querySelector('span').getBoundingClientRect();
        return rect.left+rect.width/2;
      });
      return {count:buttons.length, widths:rects.map(rect=>rect.width), lefts:rects.map(rect=>rect.left),
        tops:rects.map(rect=>rect.top), bottoms:rects.map(rect=>rect.bottom),
        heroCenter:hero.left+hero.width/2, actionsCenter:actions.left+actions.width/2,
        buttonCenters:rects.map(rect=>rect.left+rect.width/2), labelCenters,
        featureChips:!!document.querySelector('.hero-features')};
    })()`);
    assert.equal(actionLayout.count, 2, `Both landing actions must render at ${width}`);
    assert.ok(Math.abs(actionLayout.widths[0] - actionLayout.widths[1]) <= 1, `Landing actions must have equal widths at ${width}`);
    assert.ok(Math.abs(actionLayout.lefts[0] - actionLayout.lefts[1]) <= 1, `Landing actions must share a left edge at ${width}`);
    assert.ok(Math.abs(actionLayout.actionsCenter - actionLayout.heroCenter) <= 1, `Landing action group must be centered under the hero copy at ${width}`);
    actionLayout.buttonCenters.forEach((center, index) => {
      assert.ok(Math.abs(center - actionLayout.labelCenters[index]) <= 2, `Landing button label ${index + 1} must be centered at ${width}`);
    });
    assert.ok(actionLayout.bottoms[0] <= actionLayout.tops[1] + 1, `Landing actions must stay stacked at ${width}`);
    assert.equal(actionLayout.featureChips, false, `Landing feature chips must stay removed at ${width}`);
    const name = `home-${width}x${height}`;
    await screenshot(name);
    report.screenshots.push({ name, width, height, fullPage: true });
  }
  report.checks.homeActionsAlignedAtEveryViewport = true;
  report.checks.homeFeatureChipsRemoved = true;
  await viewport(1440, 900);
  assert.equal(await evaluate(`document.querySelector('.brand-name')?.textContent.trim() === 'Chess Arena' &&
    !!document.querySelector('.brand-mark svg') && !document.querySelector('.logo')`), true, 'Chess Arena must use its chess brand mark');
  assert.equal(await evaluate(`document.querySelector('.arena-scene')?.querySelectorAll('.arena-square').length === 64`), true,
    'The Home hero must render the shared cinematic scene instead of an empty board');
  await evaluate(`[...document.querySelectorAll('.language-toggle button')].find(button => button.textContent.trim() === 'PL').click();true`);
  await until(`document.querySelector('h1')?.textContent.trim() === 'Graj z pomysłem.'`);
  assert.equal(await evaluate(`localStorage.getItem('lang') === 'pl' &&
    document.querySelector('.language-toggle button:last-child')?.getAttribute('aria-pressed') === 'true'`), true,
    'Polish language selection must persist and expose its selected state');
  await settle();
  await screenshot('home-polish-1440x900');
  report.screenshots.push({ name: 'home-polish-1440x900', width: 1440, height: 900, fullPage: true });
  report.checks.homeUsesChessBrand = true;
  report.checks.homeUsesCinematicScene = true;
  report.checks.homePolishTranslationPersists = true;
  await evaluate(`[...document.querySelectorAll('.language-toggle button')].find(button => button.textContent.trim() === 'EN').click();true`);
  await until(`document.querySelector('h1')?.textContent.trim() === 'Play with purpose.'`);
  report.checks.homeEnglishTranslationRestores = await evaluate(`localStorage.getItem('lang') === 'en' &&
    document.querySelector('.language-toggle button:first-child')?.getAttribute('aria-pressed') === 'true'`);
  await evaluate(`[...document.querySelectorAll('.language-toggle button')].find(button => button.textContent.trim() === 'PL').click();true`);
  await until(`document.querySelector('h1')?.textContent.trim() === 'Graj z pomysłem.'`);
  await viewport(720, 450);
  await settle();
  const zoomLayout = await evaluate(`(() => {
    const description=document.querySelector('.hero-description');
    const rect=description.getBoundingClientRect();
    return {innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
      innerHeight,descriptionRight:rect.right,descriptionClipped:description.scrollHeight>description.clientHeight+1};
  })()`);
  assert.ok(zoomLayout.scrollWidth <= zoomLayout.innerWidth + 1, 'Polish hero must not overflow at simulated 200% zoom');
  assert.ok(zoomLayout.descriptionRight <= zoomLayout.innerWidth + 1, 'Polish hero description must stay within the zoomed viewport');
  assert.equal(zoomLayout.descriptionClipped, false, 'Polish hero description must not be clipped at simulated 200% zoom');
  report.zoomCheck = { percent: 200, sourceViewport: { width: 1440, height: 900 },
    emulatedLayoutViewport: { width: 720, height: 450 }, horizontalOverflow: false,
    verticalScrollRequired: zoomLayout.scrollHeight > zoomLayout.innerHeight, polishDescriptionClipped: false };
  await screenshot('home-polish-zoom-200');
  report.screenshots.push({ name: 'home-polish-zoom-200', width: 720, height: 450, fullPage: true });
  report.checks.homePolishFitsAt200PercentZoom = true;
  await evaluate(`[...document.querySelectorAll('.language-toggle button')].find(button => button.textContent.trim() === 'EN').click();true`);
  await until(`document.querySelector('h1')?.textContent.trim() === 'Play with purpose.'`);
  await viewport(1440, 900);
  const visitLandingAction = async mode => {
    await evaluate(`document.querySelector('.hero-actions a[href="/game?mode=${mode}"]').click();true`);
    await until(`location.pathname === '/game' && new URLSearchParams(location.search).get('mode') === '${mode}' &&
      !!document.querySelector('app-game-page')`);
    await evaluate('history.back();true');
    await until(`location.pathname === '/' && !!document.querySelector('app-home-page') &&
      !!document.querySelector('.hero-actions')`);
    await sleep(80);
  };
  await visitLandingAction('bot');
  report.checks.homePlayBotNavigates = true;
  await visitLandingAction('online');
  report.checks.homePlayOnlineNavigates = true;
  await load(devUrl + '/game?mode=online');
  await until('!!window.ng?.getComponent(document.querySelector("app-game-page"))');
  const gamePage = `ng.getComponent(document.querySelector('app-game-page'))`;
  // Isolate the visual fixture from the dev server's asynchronous socket-close callback.
  await evaluate(`{const p=${gamePage};if(p.multiplayer.client)p.multiplayer.client.onWebSocketClose=()=>{};p.multiplayer.disconnect();p.multiplayer.connected$.next(true);p.multiplayer.connectionState$.next('READY');p.multiplayer.ready$.next(true);ng.applyChanges(p)};true`);
  await viewport(1440, 900);
  await sleep(100);
  const boardLayout = () => evaluate(`(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return { card: rect('.board-card'), board: rect('app-board'), square: rect('app-board .board') };
  })()`);
  await evaluate(`document.querySelector('.play-mode-switcher a[href="/game?mode=bot"]')?.click();true`);
  await until(`new URLSearchParams(location.search).get('mode') === 'bot' && !!document.querySelector('app-bot-setup')`);
  await settle();
  const botSetupBoard = await boardLayout();
  await screenshot('bot-setup');
  report.screenshots.push({ name: 'bot-setup', width: 1440, height: 900, fullPage: true });
  await evaluate(`document.querySelector('.play-mode-switcher a[href="/game?mode=online"]')?.click();true`);
  await until(`new URLSearchParams(location.search).get('mode') === 'online' && !!document.querySelector('app-multiplayer-lobby')`);
  await evaluate(`{const p=${gamePage};if(p.multiplayer.client)p.multiplayer.client.onWebSocketClose=()=>{};p.multiplayer.disconnect();p.multiplayer.connected$.next(true);p.multiplayer.connectionState$.next('READY');p.multiplayer.ready$.next(true);ng.applyChanges(p)};true`);
  await settle();
  const lobbyBoard = await boardLayout();
  for (const region of ['card', 'board', 'square']) {
    for (const dimension of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(botSetupBoard[region][dimension] - lobbyBoard[region][dimension]) <= 1,
        `Bot and multiplayer ${region} ${dimension} must align`);
    }
  }
  const lobbyCardLayout = await evaluate(`(() => {
    const card = document.querySelector('.settings-card').getBoundingClientRect();
    const lobby = document.querySelector('app-multiplayer-lobby').getBoundingClientRect();
    const quickStart = document.querySelector('.online-quick-actions .arena-button').getBoundingClientRect();
    return { cardBottom: card.bottom, lobbyBottom: lobby.bottom, quickStartBottom: quickStart.bottom };
  })()`);
  assert.ok(lobbyCardLayout.quickStartBottom <= lobbyCardLayout.cardBottom + 1,
    'Quick start must stay inside the multiplayer setup card');
  assert.ok(lobbyCardLayout.lobbyBottom <= lobbyCardLayout.cardBottom + 1,
    'The multiplayer lobby must stay inside its setup card');
  const defaultLobbyState = await evaluate(`({
    selectedTabs: document.querySelectorAll('.lobby-tabs [aria-selected="true"]').length,
    arenaVisible: !!document.querySelector('.online-arena-stage app-chess-arena-animation'),
    setupVisible: !!document.querySelector('app-multiplayer-lobby')
  })`);
  assert.equal(defaultLobbyState.selectedTabs, 0, 'No lobby tab should be selected by default');
  assert.equal(defaultLobbyState.arenaVisible, true, 'The Arena should be visible before opening a lobby panel');
  assert.equal(defaultLobbyState.setupVisible, true, 'The multiplayer controls should stay available');
  report.modeBoardLayout = { botSetup: botSetupBoard, multiplayerLobby: lobbyBoard };
  report.checks.botAndMultiplayerBoardsAligned = true;
  report.checks.lobbyContentFitsSetupCard = true;
  report.checks.lobbyArenaVisibleWithNoDefaultSelection = true;
  await screenshot('lobby-idle');
  report.screenshots.push({ name: 'lobby-idle', width: 1440, height: 900, fullPage: true });
  for (const [view, panelId] of [
    ['public', 'online-panel-public'],
    ['create', 'online-panel-create'],
    ['join', 'online-panel-join'],
    ['manage', 'online-panel-manage']
  ]) {
    await evaluate(`document.querySelector('#online-tab-${view}')?.click();true`);
    await until(`!!document.querySelector('.online-lobby-panel #${panelId}')`);
    assert.equal(await evaluate(`!!document.querySelector('.online-arena-stage app-chess-arena-animation')`), false,
      `${view} panel should replace the Arena illustration`);
  }
  await evaluate(`document.querySelector('#online-tab-manage')?.click();true`);
  await until(`!!document.querySelector('.online-arena-stage app-chess-arena-animation') &&
    document.querySelectorAll('.lobby-tabs [aria-selected="true"]').length === 0`);
  report.checks.allLobbyPanelsReplaceArena = true;
  report.lobbyResponsive = [];
  await evaluate(`document.querySelector('#online-tab-public')?.click();true`);
  await until(`!!document.querySelector('.room-chat--embedded')`);
  for (const [width, height] of responsiveViewports) {
    await viewport(width, height);
    const layout = await evaluate(`({innerWidth,scrollWidth:document.documentElement.scrollWidth,
      innerHeight,scrollHeight:document.documentElement.scrollHeight,
      cardBottom:document.querySelector('.settings-card')?.getBoundingClientRect().bottom,
      lobbyBottom:document.querySelector('app-multiplayer-lobby')?.getBoundingClientRect().bottom,
      quickStartBottom:document.querySelector('.online-quick-actions .arena-button')?.getBoundingClientRect().bottom,
      panel:document.querySelector('#online-panel-public').getBoundingClientRect().toJSON(),
      roomGrid:document.querySelector('.room-grid').getBoundingClientRect().toJSON(),
      chat:document.querySelector('.room-chat--embedded').getBoundingClientRect().toJSON(),
      composer:document.querySelector('.room-chat--embedded .chat-input').getBoundingClientRect().toJSON(),
      roomColumns:getComputedStyle(document.querySelector('.room-grid')).gridTemplateColumns.split(' ').length})`);
    assert.ok(layout.scrollWidth <= layout.innerWidth + 1, `Lobby horizontal overflow at ${width}x${height}`);
    assert.ok(layout.quickStartBottom <= layout.cardBottom + 1,
      `Quick start must stay inside the lobby card at ${width}x${height}`);
    assert.ok(layout.lobbyBottom <= layout.cardBottom + 1,
      `Lobby content must stay inside its card at ${width}x${height}`);
    assert.ok(Math.abs((layout.chat.top - layout.panel.top) / layout.panel.height - .5) < .05,
      `Room chat must occupy the bottom half at ${width}x${height}`);
    assert.ok(layout.roomColumns >= 2, `Public rooms must use tiles at ${width}x${height}`);
    assert.ok(layout.roomGrid.bottom <= layout.chat.top + 1,
      `Room tiles must stay above the chat at ${width}x${height}`);
    assert.ok(layout.composer.bottom <= layout.panel.bottom + 1,
      `Chat composer must stay inside its panel at ${width}x${height}`);
    report.lobbyResponsive.push({ width, height, horizontalOverflow: false,
      verticalScrollRequired: layout.scrollHeight > layout.innerHeight, quickStartInsideCard: true,
      roomColumns: layout.roomColumns, chatInBottomHalf: true, chatComposerInsidePanel: true });
  }
  await evaluate(`document.querySelector('#online-tab-public')?.click();true`);
  await until(`!!document.querySelector('.online-arena-stage app-chess-arena-animation')`);
  report.checks.publicRoomTilesAndChatFitAtEveryViewport = true;
  report.checks.lobbyNoHorizontalOverflowAtEveryViewport = true;
  report.checks.lobbyContentFitsAtEveryViewport = true;
  await viewport(1440, 900);
  await evaluate(`{const p=${gamePage};p.multiplayer.queueState$.next('QUEUED');ng.applyChanges(p)};true`);
  await sleep(450);
  await screenshot('waiting-for-opponent');
  const event = { gameId: 'visual-fixture-match', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'WHITE', yourColor: 'WHITE', timeControlType: 'RAPID', whiteTimeLeftMs: 600000, blackTimeLeftMs: 600000,
    reconnectToken: 'visual-fixture-only', version: 0 };
  await evaluate(`{const p=${gamePage};p.multiplayer.handleGameStarted(${JSON.stringify(event)});ng.applyChanges(p)};true`);
  assert.equal(await evaluate(`${gamePage}.canHumanMove()`), true, 'Gameplay must be available during match celebration');
  await evaluate(`${gamePage}.onSquareClick('e2');ng.applyChanges(${gamePage});true`);
  assert.equal(await evaluate(`${gamePage}.state.selectedSquare$.value`), 'e2');
  await sleep(600);
  await screenshot('match-found');
  await sleep(1100);
  await until('!document.querySelector("app-chess-arena-animation")');
  report.activeGameResponsive = [];
  for (const [width, height] of responsiveViewports) {
    await viewport(width, height);
    const layout = await evaluate(`(() => {
      const board=document.querySelector('app-board');
      const rect=board?.getBoundingClientRect();
      let blurred=false;
      for(let node=board;node;node=node.parentElement){if(getComputedStyle(node).filter.includes('blur('))blurred=true;}
      return {innerWidth,scrollWidth:document.documentElement.scrollWidth,innerHeight,
        scrollHeight:document.documentElement.scrollHeight,boardLeft:rect?.left,boardRight:rect?.right,blurred};
    })()`);
    assert.ok(layout.scrollWidth <= layout.innerWidth + 1, `Active game horizontal overflow at ${width}x${height}`);
    assert.ok(layout.boardLeft >= -1 && layout.boardRight <= layout.innerWidth + 1,
      `Chessboard must stay within the viewport at ${width}x${height}`);
    assert.equal(layout.blurred, false, `Chessboard must not be blurred during active play at ${width}x${height}`);
    report.activeGameResponsive.push({ width, height, horizontalOverflow: false,
      verticalScrollRequired: layout.scrollHeight > layout.innerHeight, boardWithinViewport: true, blurred: false });
  }
  report.checks.activeGameResponsiveAtEveryViewport = true;
  await viewport(1440, 900);
  await evaluate(`{const p=${gamePage};p.multiplayer.handleGameStarted(${JSON.stringify(event)});ng.applyChanges(p)};true`);
  assert.equal(await evaluate(`${gamePage}.multiplayer.matchFound$.value`), false, 'Duplicate event must not celebrate again');
  await evaluate(`{const p=${gamePage};p.multiplayer.connectionState$.next('RECONNECTING');ng.applyChanges(p)};true`);
  await until('!!document.querySelector("app-chess-arena-animation svg")');
  assert.equal(await evaluate('document.querySelector("app-chess-arena-animation").classList.contains("has-intro")'), false);
  await screenshot('reconnecting');
  report.checks.matchAvailableImmediately = true;
  report.checks.duplicateMatchIgnored = true;
  report.checks.sceneRemovedDuringGameplay = true;
  report.checks.reconnectSkipsIntro = true;

  // Performance is measured against the optimized production bundle, never the dev fixture.
  await viewport(1440, 900);
  await load(prodUrl);
  await sleep(3800);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(100);
  assert.equal(await evaluate('document.querySelector("app-chess-arena-animation").getAnimations({subtree:true}).length'), 0);
  await screenshot('reduced-motion');
  report.checks.reducedMotionHasNoAnimations = true;
  await send('Emulation.setEmulatedMedia', { features: [] });
  await viewport(375, 200);
  await evaluate('scrollTo(0,0);true');
  await sleep(300);
  assert.equal(await evaluate('document.querySelector("app-chess-arena-animation").classList.contains("is-paused")'), true);
  await evaluate('document.querySelector("app-chess-arena-animation").scrollIntoView();true');
  await sleep(300);
  assert.equal(await evaluate('document.querySelector("app-chess-arena-animation").classList.contains("is-paused")'), false);
  report.checks.offscreenPauseAndResume = true;
  for (const [name, width, height, rate, waiting] of [['desktop',1440,900,1,false], ['desktop-cpu4',1440,900,4,false], ['mobile-cpu4',375,667,4,false], ['waiting-cpu4',1440,900,4,true]]) {
    await viewport(width, height);
    await send('Emulation.setCPUThrottlingRate', { rate });
    await evaluate(`document.querySelector('.arena-animation').classList.toggle('state-waiting',${waiting});true`);
    await evaluate('document.querySelector("app-chess-arena-animation").scrollIntoView({block:"center"});true');
    await sleep(300);
    const sample = await evaluate(`new Promise(resolve=>{const frames=[],longTasks=[];const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});let start,last;function frame(now){if(!start){start=last=now} else{frames.push(now-last);last=now}if(now-start<6000){requestAnimationFrame(frame)}else{observer.disconnect();const sorted=[...frames].sort((a,b)=>a-b);resolve({fps:frames.length*1000/(now-start),p95FrameMs:sorted[Math.floor(sorted.length*.95)],maxFrameMs:Math.max(...frames),longTasks:longTasks.length,maxLongTaskMs:longTasks.length?Math.max(...longTasks):0,frames:frames.length})}}requestAnimationFrame(frame)})`);
    report.benchmarks.push({ name, width, height, cpuSlowdown: rate, state: waiting ? 'WAITING_FOR_OPPONENT (CSS fixture)' : 'LOBBY', ...sample });
    console.log(name, JSON.stringify(sample));
  }
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await evaluate(`document.querySelector('.arena-animation').classList.remove('state-waiting');true`);
  await viewport(1440, 900);
  const roundTrip = async () => {
    await evaluate(`document.querySelector('a[href="/game?mode=bot"]').click();true`);
    await until('!!document.querySelector("app-game-page")');
    assert.equal(await evaluate('!!document.querySelector("app-chess-arena-animation")'), false);
    await evaluate('history.back();true');
    await until('!!document.querySelector("app-chess-arena-animation svg")');
    await sleep(80);
  };
  await roundTrip(); // warm up the bot route before measuring retained objects
  await send('HeapProfiler.collectGarbage');
  const before = { heap: await send('Runtime.getHeapUsage'), dom: await send('Memory.getDOMCounters') };
  const navigationSamples = [];
  const sampleAtCycles = new Set([1, 5, 10, 20]);
  for (let i = 1; i <= 20; i++) {
    await roundTrip();
    if (sampleAtCycles.has(i)) {
      await send('HeapProfiler.collectGarbage');
      navigationSamples.push({ cycles: i, heap: await send('Runtime.getHeapUsage'), dom: await send('Memory.getDOMCounters') });
    }
  }
  await send('HeapProfiler.collectGarbage');
  const after = { heap: await send('Runtime.getHeapUsage'), dom: await send('Memory.getDOMCounters') };
  report.navigationMemory = { cycles: 20, before, samples: navigationSamples, after,
    retainedHeapDelta: after.heap.usedSize - before.heap.usedSize };
  report.checks.noIntroReplayAfterNavigation = await evaluate('!document.querySelector("app-chess-arena-animation").classList.contains("has-intro")');
  report.runtimeErrors = runtimeErrors;
  const stats = JSON.parse(await readFile(resolve(root, 'dist/chess-web/stats.json'), 'utf8'));
  report.sceneChunks = [];
  for (const [path, output] of Object.entries(stats.outputs)) {
    if (path.endsWith('.js') && Object.keys(output.inputs).some(input => input.includes('chess-arena-animation'))) {
      const body = await readFile(resolve(dist, path));
      report.sceneChunks.push({ path, bytes: body.length, gzipBytes: gzipSync(body).length });
    }
  }
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Arena evidence:', evidence);
  await browser.close();
  browserClosed = true;
} finally {
  if (!browserClosed) await browser.close().catch(() => {});
  server.closeAllConnections();
  server.close();
}
