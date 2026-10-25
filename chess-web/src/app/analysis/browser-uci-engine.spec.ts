import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserUciEngine } from './browser-uci-engine';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static autoSearch = true;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  commands: string[] = [];
  terminated = false;

  constructor(public url: string) { FakeWorker.instances.push(this); }
  postMessage(command: string) {
    this.commands.push(command);
    if (command === 'uci') queueMicrotask(() => {
      this.emit('option name UCI_LimitStrength type check default false');
      this.emit('option name UCI_Elo type spin default 1320 min 1320 max 3190');
      this.emit('uciok');
    });
    if (command === 'isready') queueMicrotask(() => this.emit('readyok'));
    if (command.startsWith('go ') && FakeWorker.autoSearch) queueMicrotask(() => this.emit('bestmove e2e4'));
    if (command === 'stop') queueMicrotask(() => this.emit('bestmove e2e4'));
  }
  terminate() { this.terminated = true; }
  emit(line: string) { this.onmessage?.({ data: line } as MessageEvent<string>); }
}

const options = { depth: 30, movetime: 120, multiPv: 1, target: 2800, gameplay: true };
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('BrowserUciEngine', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.autoSearch = true;
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('warms once and reuses one worker over 30 searches with exact UCI_Elo', async () => {
    const engine = new BrowserUciEngine();
    expect(FakeWorker.instances).toHaveLength(0);
    await engine.warm();
    for (let i = 0; i < 30; i++) {
      await expect(engine.search(fen, options)).resolves.toBe('e2e4');
    }
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.terminated).toBe(false);
    expect(worker.commands.filter(command => command === 'uci')).toHaveLength(1);
    expect(worker.commands).toContain('setoption name UCI_Elo value 2800');
    engine.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('cancels a search and ignores its stale result before the next search', async () => {
    const engine = new BrowserUciEngine();
    await engine.warm();
    FakeWorker.autoSearch = false;
    const first = engine.search(fen, options);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(engine.state).toBe('SEARCHING');
    FakeWorker.autoSearch = true;
    const second = engine.search(fen, options);
    await expect(first).rejects.toThrow('cancelled');
    await expect(second).resolves.toBe('e2e4');
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('recovers from a failed worker and switches flavor only on request', async () => {
    const engine = new BrowserUciEngine();
    await engine.warm();
    const lite = FakeWorker.instances[0];
    lite.onerror?.();
    expect(engine.state).toBe('FAILED');
    await engine.warm('full');
    expect(FakeWorker.instances[1].url).toContain('stockfish-19-single.js');
    expect(lite.terminated).toBe(true);
    await expect(engine.search(fen, { ...options, flavor: 'full' })).resolves.toBe('e2e4');
  });
});
