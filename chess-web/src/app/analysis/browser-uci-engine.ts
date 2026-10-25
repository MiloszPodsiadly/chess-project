export type BrowserEngineFlavor = 'lite' | 'full';

export class BrowserUciEngine {
  private worker: Worker | null = null;
  private generation = 0;
  private rejectSearch: ((reason: Error) => void) | null = null;
  private flavor: BrowserEngineFlavor | null = null;

  async search(
    fen: string,
    options: { depth: number; movetime: number; multiPv: number; flavor?: BrowserEngineFlavor },
    onInfo?: (line: string) => void
  ): Promise<string> {
    this.stop();
    const generation = this.generation;
    const flavor = options.flavor ?? 'lite';
    this.flavor = flavor;
    const filename = flavor === 'full' ? 'stockfish-19-single.js' : 'stockfish-19-lite-single.js';
    const worker = new Worker(`/stockfish/${filename}`);
    this.worker = worker;

    return new Promise<string>((resolve, reject) => {
      let phase: 'uci' | 'ready' | 'search' = 'uci';
      const timer = window.setTimeout(() => fail(new Error('Stockfish.js timed out')),
        (flavor === 'full' ? 120000 : 30000) + options.movetime);
      const fail = (error: Error) => {
        if (generation !== this.generation) return;
        window.clearTimeout(timer);
        this.rejectSearch = null;
        this.stop();
        reject(error);
      };
      this.rejectSearch = (reason) => {
        window.clearTimeout(timer);
        reject(reason);
      };
      worker.onerror = () => fail(new Error(`Could not load Stockfish.js ${flavor}`));
      worker.onmessage = (event: MessageEvent<string>) => {
        if (generation !== this.generation) return;
        const line = String(event.data ?? '').trim();
        if (phase === 'uci' && line === 'uciok') {
          phase = 'ready';
          worker.postMessage('isready');
        } else if (phase === 'ready' && line === 'readyok') {
          phase = 'search';
          worker.postMessage(`setoption name MultiPV value ${Math.max(1, Math.min(5, options.multiPv))}`);
          worker.postMessage(`position fen ${fen}`);
          worker.postMessage(`go depth ${options.depth} movetime ${options.movetime}`);
        } else if (phase === 'search' && line.startsWith('info ')) {
          onInfo?.(line);
        } else if (phase === 'search' && line.startsWith('bestmove ')) {
          const move = line.split(/\s+/)[1];
          if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move ?? '')) {
            fail(new Error('Stockfish.js returned no legal move'));
            return;
          }
          window.clearTimeout(timer);
          this.rejectSearch = null;
          worker.terminate();
          this.worker = null;
          resolve(move);
        }
      };
      worker.postMessage('uci');
    });
  }

  stop(): void {
    this.generation++;
    const reject = this.rejectSearch;
    this.rejectSearch = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    reject?.(new Error('Stockfish.js search cancelled'));
  }

  dispose(): void {
    this.stop();
  }

  activeFlavor(): BrowserEngineFlavor | null {
    return this.flavor;
  }
}
