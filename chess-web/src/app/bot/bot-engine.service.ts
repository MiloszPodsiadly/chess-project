import { Injectable } from '@angular/core';
import { BrowserUciEngine, BrowserEngineFlavor } from '../analysis/browser-uci-engine';

@Injectable({ providedIn: 'root' })
export class BotEngineService {
  private readonly engine = new BrowserUciEngine();

  warm(flavor: BrowserEngineFlavor = 'lite'): Promise<void> {
    return this.engine.warm(flavor);
  }

  getMove(fen: string, elo: number | null, flavor: BrowserEngineFlavor = 'lite', maximumMs = 300): Promise<string> {
    const movetime = elo === null ? maximumMs : flavor === 'full' ? 300 : elo < 1000 ? 80 : elo < 1800 ? 120 : 200;
    return this.engine.search(fen, {
      depth: 30,
      movetime,
      multiPv: 1,
      target: elo ?? undefined,
      gameplay: true,
      flavor
    });
  }

  stop(): void {
    this.engine.stop();
  }

  dispose(): void {
    this.engine.dispose();
  }
}
