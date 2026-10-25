export type BrowserEngineFlavor = 'lite' | 'full';
export type BrowserEngineState = 'UNINITIALIZED' | 'LOADING' | 'READY' | 'SEARCHING'
  | 'STOPPING' | 'FAILED' | 'DISPOSED';

type SearchOptions = {
  depth: number;
  movetime: number;
  multiPv: number;
  flavor?: BrowserEngineFlavor;
  target?: number;
  gameplay?: boolean;
};

export class BrowserUciEngine {
  state: BrowserEngineState = 'UNINITIALIZED';
  private worker: Worker | null = null;
  private flavor: BrowserEngineFlavor | null = null;
  private generation = 0;
  private requestId = 0;
  private options = new Set<string>();
  private loading: Promise<void> | null = null;
  private resolveLoading: (() => void) | null = null;
  private rejectLoading: ((error: Error) => void) | null = null;
  private loadingTimer: number | null = null;
  private pendingReady: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private readyTimer: number | null = null;
  private pending: { resolve: (move: string) => void; reject: (error: Error) => void;
    onInfo?: (line: string) => void } | null = null;
  private stopping: Promise<void> | null = null;
  private resolveStopping: (() => void) | null = null;
  private stopTimer: number | null = null;
  private searchTimer: number | null = null;

  activeFlavor(): BrowserEngineFlavor | null { return this.flavor; }
  supportsNativeElo(): boolean { return this.options.has('UCI_Elo') && this.options.has('UCI_LimitStrength'); }

  warm(flavor: BrowserEngineFlavor = 'lite'): Promise<void> {
    if (this.state === 'DISPOSED') return Promise.reject(new Error('Stockfish.js is disposed'));
    if (this.worker && this.flavor === flavor) return this.loading ?? Promise.resolve();
    if (this.worker) this.terminate(new Error('Engine flavor changed'));
    this.state = 'LOADING';
    this.flavor = flavor;
    this.options.clear();
    const generation = ++this.generation;
    const filename = flavor === 'full' ? 'stockfish-19-single.js' : 'stockfish-19-lite-single.js';
    try {
      this.worker = new Worker(`/stockfish/${filename}`);
    } catch {
      this.state = 'FAILED';
      return Promise.reject(new Error(`Could not load Stockfish.js ${flavor}`));
    }
    this.loading = new Promise<void>((resolve, reject) => {
      this.resolveLoading = resolve;
      this.rejectLoading = reject;
    });
    this.loadingTimer = window.setTimeout(() => this.fail(new Error('Stockfish.js initialization timed out')),
      flavor === 'full' ? 120000 : 30000);
    this.worker.onerror = () => this.fail(new Error(`Could not load Stockfish.js ${flavor}`));
    this.worker.onmessage = (event: MessageEvent<string>) => {
      if (generation !== this.generation) return;
      this.onLine(String(event.data ?? '').trim());
    };
    this.worker.postMessage('uci');
    return this.loading;
  }

  async search(fen: string, options: SearchOptions, onInfo?: (line: string) => void): Promise<string> {
    if (!Number.isInteger(options.movetime) || options.movetime < 1 || options.movetime > 10000) {
      throw new RangeError('Browser search budget must be 1–10000 ms');
    }
    const flavor = options.flavor ?? 'lite';
    if (this.worker && this.flavor !== flavor) this.terminate(new Error('Engine flavor changed'));
    if (this.state === 'SEARCHING') this.stop();
    const requestId = ++this.requestId;
    await this.warm(flavor);
    if (this.stopping) await this.stopping;
    if (requestId !== this.requestId) throw new Error('Stockfish.js search cancelled');
    if (this.state !== 'READY' || !this.worker) throw new Error('Stockfish.js is unavailable');

    const commands = options.gameplay && options.target != null
      ? this.strengthCommands(options.target) : ['setoption name UCI_LimitStrength value false',
        'setoption name Skill Level value 20'];
    for (const command of commands) this.worker.postMessage(command);
    this.worker.postMessage(`setoption name MultiPV value ${Math.max(1, Math.min(5, options.multiPv))}`);
    await new Promise<void>((resolve, reject) => {
      this.pendingReady = { resolve, reject };
      this.readyTimer = window.setTimeout(() => this.fail(new Error('Stockfish.js readiness timed out')), 5000);
      this.worker!.postMessage('isready');
    });
    if (requestId !== this.requestId || !this.worker) throw new Error('Stockfish.js search cancelled');
    this.worker.postMessage(`position fen ${fen}`);
    const depth = Math.max(1, Math.min(40, options.depth));
    const movetime = options.movetime;
    this.state = 'SEARCHING';
    return new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject, onInfo };
      this.worker!.postMessage(`go depth ${depth} movetime ${movetime}`);
      this.searchTimer = window.setTimeout(() => this.fail(new Error('Stockfish.js search timed out')),
        movetime + 3000);
    });
  }

  stop(): void {
    this.requestId++;
    if (this.state === 'LOADING' || this.pendingReady) {
      this.terminate(new Error('Stockfish.js search cancelled'));
      return;
    }
    if (this.state !== 'SEARCHING' || !this.worker) return;
    this.clearSearchTimer();
    this.pending?.reject(new Error('Stockfish.js search cancelled'));
    this.pending = null;
    this.state = 'STOPPING';
    this.stopping = new Promise<void>(resolve => { this.resolveStopping = resolve; });
    this.worker.postMessage('stop');
    this.stopTimer = window.setTimeout(() => {
      this.terminate(new Error('Stockfish.js stop timed out'));
      this.state = 'FAILED';
    }, 1500);
  }

  dispose(): void {
    this.terminate(new Error('Stockfish.js disposed'));
    this.state = 'DISPOSED';
  }

  private strengthCommands(target: number): string[] {
    if (target >= 1320) {
      if (!this.supportsNativeElo()) throw new Error('This browser engine does not support UCI_Elo');
      return ['setoption name Skill Level value 20',
        `setoption name UCI_Elo value ${target}`,
        'setoption name UCI_LimitStrength value true'];
    }
    const skill = Math.max(0, Math.min(20, Math.floor((target - 200) / 150)));
    return ['setoption name UCI_LimitStrength value false',
      `setoption name Skill Level value ${skill}`];
  }

  private onLine(line: string): void {
    if (line.startsWith('option name ')) {
      const name = line.slice(12).split(' type ')[0];
      this.options.add(name);
    } else if (line === 'uciok' && this.state === 'LOADING') {
      this.worker?.postMessage('isready');
    } else if (line === 'readyok') {
      if (this.state === 'LOADING') {
        this.state = 'READY';
        this.clearLoadingTimer();
        this.resolveLoading?.();
        this.resolveLoading = null;
        this.rejectLoading = null;
        this.loading = null;
      } else {
        if (this.readyTimer !== null) window.clearTimeout(this.readyTimer);
        this.readyTimer = null;
        this.pendingReady?.resolve();
        this.pendingReady = null;
      }
    } else if (line.startsWith('info ') && this.state === 'SEARCHING') {
      this.pending?.onInfo?.(line);
    } else if (line.startsWith('bestmove ')) {
      if (this.state === 'STOPPING') {
        if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
        this.stopTimer = null;
        this.state = 'READY';
        this.resolveStopping?.();
        this.resolveStopping = null;
        this.stopping = null;
      } else if (this.state === 'SEARCHING') {
        this.clearSearchTimer();
        const pending = this.pending;
        this.pending = null;
        this.state = 'READY';
        const move = line.split(/\s+/)[1];
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move ?? '')) pending?.resolve(move);
        else pending?.reject(new Error('Stockfish.js returned no legal move'));
      }
    }
  }

  private fail(error: Error): void {
    this.terminate(error);
    this.state = 'FAILED';
  }

  private terminate(error: Error): void {
    this.generation++;
    this.requestId++;
    this.clearLoadingTimer();
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.clearSearchTimer();
    if (this.readyTimer !== null) window.clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.rejectLoading?.(error);
    this.pending?.reject(error);
    this.pendingReady?.reject(error);
    this.resolveStopping?.();
    this.resolveLoading = null;
    this.rejectLoading = null;
    this.pendingReady = null;
    this.resolveStopping = null;
    this.loading = null;
    this.pending = null;
    this.stopping = null;
    this.worker?.terminate();
    this.worker = null;
    this.flavor = null;
    this.state = 'UNINITIALIZED';
  }

  private clearLoadingTimer(): void {
    if (this.loadingTimer !== null) window.clearTimeout(this.loadingTimer);
    this.loadingTimer = null;
  }

  private clearSearchTimer(): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
  }
}
