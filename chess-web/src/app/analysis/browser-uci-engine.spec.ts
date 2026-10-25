import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserUciEngine } from './browser-uci-engine';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  commands: string[] = [];
  terminated = false;

  constructor(public url: string) { FakeWorker.instances.push(this); }
  postMessage(command: string) { this.commands.push(command); }
  terminate() { this.terminated = true; }
  emit(line: string) { this.onmessage?.({ data: line } as MessageEvent<string>); }
}

const options = { depth: 8, movetime: 100, multiPv: 1 };
const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('BrowserUciEngine', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lazy loads Lite and searches only after the UCI readiness handshake', async () => {
    const engine = new BrowserUciEngine();
    expect(FakeWorker.instances).toHaveLength(0);
    const result = engine.search(fen, options);
    const worker = FakeWorker.instances[0];
    expect(worker.url).toContain('stockfish-19-lite-single.js');
    expect(worker.commands).toEqual(['uci']);
    worker.emit('uciok');
    expect(worker.commands.at(-1)).toBe('isready');
    worker.emit('readyok');
    expect(worker.commands).toContain(`position fen ${fen}`);
    worker.emit('bestmove e2e4');
    await expect(result).resolves.toBe('e2e4');
    expect(worker.terminated).toBe(true);
  });

  it('cancels the old worker and ignores its late result', async () => {
    const engine = new BrowserUciEngine();
    const first = engine.search(fen, options);
    const oldWorker = FakeWorker.instances[0];
    const second = engine.search(fen, { ...options, flavor: 'full' });
    await expect(first).rejects.toThrow('cancelled');
    expect(oldWorker.terminated).toBe(true);
    oldWorker.emit('bestmove a2a3');
    const worker = FakeWorker.instances[1];
    expect(worker.url).toContain('stockfish-19-single.js');
    worker.emit('uciok');
    worker.emit('readyok');
    worker.emit('bestmove d2d4');
    await expect(second).resolves.toBe('d2d4');
  });

  it('reports a failed WASM worker load', async () => {
    const engine = new BrowserUciEngine();
    const result = engine.search(fen, options);
    const worker = FakeWorker.instances[0];
    worker.onerror?.();
    await expect(result).rejects.toThrow('Could not load');
    expect(worker.terminated).toBe(true);
  });
});
