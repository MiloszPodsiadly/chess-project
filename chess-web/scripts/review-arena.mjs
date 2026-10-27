// Local evidence runner. Requires a dev server for Angular state fixtures and a production build.
// Chrome DevTools Protocol only: no browser library or production diagnostics are added.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = resolve(root, '../docs/arena-evidence');
const profile = resolve(root, 'tmp', `arena-browser-${process.pid}`);
const devUrl = process.env.ARENA_DEV_URL || 'http://127.0.0.1:4200';
const chromePath = process.env.ARENA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dist = resolve(root, 'dist/chess-web/browser');
const sleep = ms => new Promise(r => setTimeout(r, ms));
await mkdir(evidence, { recursive: true });
await mkdir(profile, { recursive: true });
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
const browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
let socket;
let closeBrowser = async () => {};
let browserClosed = false;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await sleep(100); }
  }
  assert.ok(port, 'Chrome did not expose a DevTools port');
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, reject) => { socket.onopen = r; socket.onerror = reject; });
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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  closeBrowser = () => send('Browser.close');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
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
  const settle = () => evaluate(`document.querySelector('app-chess-arena-animation').getAnimations({subtree:true}).forEach(a=>{if(a.effect.getTiming().iterations!==Infinity)a.finish()}); true`);
  const screenshot = async name => {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
    await writeFile(resolve(evidence, name + '.png'), Buffer.from(data, 'base64'));
  };
  const report = { timestamp: new Date().toISOString(), browser: await send('Browser.getVersion'),
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
  for (const [width, height] of [[375,667],[390,844],[768,1024],[1024,768],[1280,720],[1366,768],[1440,900],[1920,1080]]) {
    await viewport(width, height);
    await settle();
    await sleep(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, `Horizontal overflow at ${width}`);
    const actionLayout = await evaluate(`(() => {
      const buttons=[...document.querySelectorAll('.hero-actions .arena-button')];
      const rects=buttons.map(button=>button.getBoundingClientRect());
      return {count:buttons.length, widths:rects.map(rect=>rect.width), lefts:rects.map(rect=>rect.left),
        tops:rects.map(rect=>rect.top), bottoms:rects.map(rect=>rect.bottom), featureChips:!!document.querySelector('.hero-features')};
    })()`);
    assert.equal(actionLayout.count, 2, `Both landing actions must render at ${width}`);
    assert.ok(Math.abs(actionLayout.widths[0] - actionLayout.widths[1]) <= 1, `Landing actions must have equal widths at ${width}`);
    assert.ok(Math.abs(actionLayout.lefts[0] - actionLayout.lefts[1]) <= 1, `Landing actions must share a left edge at ${width}`);
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
  const page = `ng.getComponent(document.querySelector('app-game-page'))`;
  // Isolate the visual fixture from the dev server's asynchronous socket-close callback.
  await evaluate(`{const p=${page};if(p.multiplayer.client)p.multiplayer.client.onWebSocketClose=()=>{};p.multiplayer.disconnect();p.multiplayer.connected$.next(true);p.multiplayer.connectionState$.next('READY');p.multiplayer.ready$.next(true);ng.applyChanges(p)};true`);
  await settle();
  await screenshot('lobby-idle');
  await evaluate(`{const p=${page};p.multiplayer.queueState$.next('QUEUED');ng.applyChanges(p)};true`);
  await sleep(450);
  await screenshot('waiting-for-opponent');
  const event = { gameId: 'visual-fixture-match', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    sideToMove: 'WHITE', yourColor: 'WHITE', timeControlType: 'RAPID', whiteTimeLeftMs: 600000, blackTimeLeftMs: 600000,
    reconnectToken: 'visual-fixture-only', version: 0 };
  await evaluate(`{const p=${page};p.multiplayer.handleGameStarted(${JSON.stringify(event)});ng.applyChanges(p)};true`);
  assert.equal(await evaluate(`${page}.canHumanMove()`), true, 'Gameplay must be available during match celebration');
  await evaluate(`${page}.onSquareClick('e2');ng.applyChanges(${page});true`);
  assert.equal(await evaluate(`${page}.state.selectedSquare$.value`), 'e2');
  await sleep(600);
  await screenshot('match-found');
  await sleep(1100);
  await until('!document.querySelector("app-chess-arena-animation")');
  await screenshot('active-game');
  await evaluate(`{const p=${page};p.multiplayer.handleGameStarted(${JSON.stringify(event)});ng.applyChanges(p)};true`);
  assert.equal(await evaluate(`${page}.multiplayer.matchFound$.value`), false, 'Duplicate event must not celebrate again');
  await evaluate(`{const p=${page};p.multiplayer.connectionState$.next('RECONNECTING');ng.applyChanges(p)};true`);
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
  await send('Browser.close');
  browserClosed = true;
} finally {
  if (socket?.readyState === 1 && !browserClosed) await closeBrowser().catch(() => {});
  socket?.close();
  if (browser.exitCode === null) browser.kill();
  server.closeAllConnections();
  server.close();
}
