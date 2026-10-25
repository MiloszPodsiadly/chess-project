import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotEngineService } from './bot-engine.service';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(command: string) {
    if (command === 'uci') queueMicrotask(() => {
      this.emit('option name UCI_LimitStrength type check default false');
      this.emit('option name UCI_Elo type spin default 1320 min 1320 max 3190');
      this.emit('uciok');
    });
    if (command === 'isready') queueMicrotask(() => this.emit('readyok'));
    if (command.startsWith('go ')) queueMicrotask(() => this.emit('bestmove e2e4'));
  }
  emit(line: string) { this.onmessage?.({ data: line } as MessageEvent<string>); }
  terminate() { this.terminated = true; }
}

describe('BotEngineService route lifecycle', () => {
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => vi.unstubAllGlobals());

  it('creates a fresh worker after a route disposes the previous one', async () => {
    const service = new BotEngineService();
    await service.warm('lite');
    service.dispose();
    expect(FakeWorker.instances[0].terminated).toBe(true);
    await service.warm('lite');
    expect(FakeWorker.instances).toHaveLength(2);
    await expect(service.getMove('startpos', 1200)).resolves.toBe('e2e4');
    service.dispose();
  });

  it('keeps a warm worker when a page stops its search on navigation', async () => {
    const service = new BotEngineService();
    await service.warm('lite');
    service.stop();
    await service.warm('lite');
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    service.ngOnDestroy();
  });
});
